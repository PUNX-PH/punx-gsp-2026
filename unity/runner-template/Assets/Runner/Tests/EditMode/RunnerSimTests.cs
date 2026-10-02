using System.Linq;
using NUnit.Framework;
using Runner.Settings;
using Runner.Sim;
using UnityEngine;

namespace Runner.Tests
{
    public class RunnerSimTests
    {
        const float Step = 1f / 120f;

        // Distance before an obstacle at which a jump at the default tuning (6 m/s, 2.2 m) peaks over it.
        static readonly float TakeOffDistance = 6f * Mathf.Sqrt(2f * 2.2f / 30f);

        static Tuning Defaults() => new Tuning { speed = 6f, jumpHeight = 2.2f, obstacleSpacing = 12f };

        // Runs the sim, jumping once at the right moment for the first obstacle, until Z passes targetZ.
        static void JumpOverFirstObstacleUntil(RunnerSim sim, float targetZ)
        {
            var jumped = false;
            for (var i = 0; i < 1200 && !sim.GameOver && sim.Z <= targetZ; i++)
            {
                var jump = !jumped && sim.Z >= RunnerSim.FirstSpawnZ - TakeOffDistance;
                jumped |= jump;
                sim.Tick(Step, jump);
            }
        }

        static void AssertFinite(float value, string what)
        {
            Assert.IsFalse(float.IsNaN(value) || float.IsInfinity(value), what + " is " + value);
        }

        [Test]
        public void Moves_forward_at_tuning_speed()
        {
            var sim = new RunnerSim(Defaults());
            for (var i = 0; i < 120; i++) sim.Tick(Step, false);
            Assert.AreEqual(6f, sim.Z, 0.01f);
        }

        [Test]
        public void Jump_apex_equals_jumpHeight()
        {
            var sim = new RunnerSim(Defaults());
            var apex = 0f;
            for (var i = 0; i < 240; i++)
            {
                sim.Tick(Step, i == 0);
                apex = Mathf.Max(apex, sim.HeroY);
            }
            Assert.AreEqual(2.2f, apex, 0.05f);
            Assert.IsTrue(sim.Grounded);
            Assert.AreEqual(0f, sim.HeroY);
        }

        [Test]
        public void Jump_in_air_is_ignored()
        {
            var sim = new RunnerSim(Defaults());
            var apex = 0f;
            for (var i = 0; i < 240; i++)
            {
                sim.Tick(Step, i == 0 || i == 24); // second press at 0.2 s, while airborne
                apex = Mathf.Max(apex, sim.HeroY);
            }
            Assert.LessOrEqual(apex, 2.25f);
        }

        [Test]
        public void Large_dt_is_clamped()
        {
            var sim = new RunnerSim(Defaults());
            sim.Tick(10f, false);
            Assert.AreEqual(6f * 0.05f, sim.Z, 1e-4f);
        }

        [Test]
        public void Obstacles_are_spaced_by_obstacleSpacing()
        {
            var sim = new RunnerSim(Defaults());
            sim.Tick(Step, false);
            var obstacles = sim.Entities.Where(e => e.Kind == EntityKind.Obstacle).Select(e => e.Z).ToList();
            var collectibles = sim.Entities.Where(e => e.Kind == EntityKind.Collectible).Select(e => e.Z).ToList();
            CollectionAssert.AreEqual(new[] { 20f, 32f, 44f }, obstacles.Take(3).ToArray(), new FloatComparer());
            CollectionAssert.AreEqual(new[] { 26f, 38f, 50f }, collectibles.Take(3).ToArray(), new FloatComparer());
        }

        [Test]
        public void Running_into_obstacle_ends_game()
        {
            var sim = new RunnerSim(Defaults());
            for (var i = 0; i < 1200 && !sim.GameOver; i++) sim.Tick(Step, false);
            Assert.IsTrue(sim.GameOver);
            Assert.That(sim.Z, Is.InRange(19.2f, 20.8f));
        }

        [Test]
        public void Jumping_over_obstacle_survives()
        {
            var sim = new RunnerSim(Defaults());
            JumpOverFirstObstacleUntil(sim, 22f);
            Assert.Greater(sim.Z, 22f);
            Assert.IsFalse(sim.GameOver);
        }

        [Test]
        public void Collecting_increments_score_and_deactivates()
        {
            var sim = new RunnerSim(Defaults());
            JumpOverFirstObstacleUntil(sim, 27f);
            Assert.IsFalse(sim.GameOver);
            Assert.AreEqual(1, sim.Score);
            var collectible = sim.Entities.First(e => e.Kind == EntityKind.Collectible && Mathf.Abs(e.Z - 26f) < 1e-3f);
            Assert.IsFalse(collectible.Active);
        }

        [Test]
        public void GameOver_freezes_and_Restart_resets()
        {
            var sim = new RunnerSim(Defaults());
            for (var i = 0; i < 1200 && !sim.GameOver; i++) sim.Tick(Step, false);
            var frozenZ = sim.Z;
            sim.Tick(1f, false);
            Assert.AreEqual(frozenZ, sim.Z);

            sim.Restart();
            Assert.AreEqual(0f, sim.Z);
            Assert.AreEqual(0, sim.Score);
            Assert.IsFalse(sim.GameOver);
            sim.Tick(Step, false);
            Assert.Greater(sim.Z, 0f);
        }

        [Test]
        public void Restart_reactivates_collectibles()
        {
            var sim = new RunnerSim(Defaults());
            JumpOverFirstObstacleUntil(sim, 27f);
            Assert.AreEqual(1, sim.Score);

            sim.Restart();
            sim.Tick(Step, false);
            var collectible = sim.Entities.First(e => e.Kind == EntityKind.Collectible && Mathf.Abs(e.Z - 26f) < 1e-3f);
            Assert.IsTrue(collectible.Active);
            Assert.AreEqual(0, sim.Score);
        }

        [Test]
        public void Bot_survives_two_minutes_at_defaults()
        {
            var sim = new RunnerSim(Defaults());
            for (var i = 0; i < 120 * 120; i++)
            {
                var jump = false;
                if (sim.Grounded)
                {
                    foreach (var e in sim.Entities)
                    {
                        if (e.Kind != EntityKind.Obstacle || e.Z <= sim.Z) continue;
                        jump = e.Z - sim.Z <= TakeOffDistance;
                        break;
                    }
                }
                sim.Tick(Step, jump);
                Assert.IsFalse(sim.GameOver, "bot died at Z=" + sim.Z);
                Assert.LessOrEqual(sim.Entities.Count, 20);
            }
            Assert.AreEqual(720f, sim.Z, 1f);
            Assert.GreaterOrEqual(sim.Score, 55);
        }

        [Test]
        public void Extreme_tuning_never_produces_NaN()
        {
            // The corner of the ranges, which Winnability rejects as unplayable: the sim itself must still stay finite.
            var sim = new RunnerSim(new Tuning { speed = 20f, jumpHeight = 1.5f, obstacleSpacing = 4f });
            for (var i = 0; i < 1200; i++)
            {
                if (sim.GameOver) sim.Restart();
                sim.Tick(Step, true);
                AssertFinite(sim.Z, "Z");
                AssertFinite(sim.HeroY, "HeroY");
            }
        }

        sealed class FloatComparer : System.Collections.IComparer
        {
            public int Compare(object x, object y)
            {
                return Mathf.Abs((float)x - (float)y) < 1e-4f ? 0 : ((float)x).CompareTo((float)y);
            }
        }
    }
}
