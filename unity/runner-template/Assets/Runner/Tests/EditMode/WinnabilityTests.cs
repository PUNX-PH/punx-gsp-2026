using NUnit.Framework;
using Runner.Settings;
using Runner.Sim;
using UnityEngine;

namespace Runner.Tests
{
    public class WinnabilityTests
    {
        const float Step = 1f / 120f;

        static Tuning T(float speed, float jump, float spacing) =>
            new Tuning { speed = speed, jumpHeight = jump, obstacleSpacing = spacing };

        // Every tuning inside the parser's ranges that Winnability accepts.
        static System.Collections.Generic.IEnumerable<Tuning> AcceptedGrid()
        {
            foreach (var spacing in new[] { 4f, 6f, 8f, 12f, 20f, 40f })
                for (var speed = 2f; speed <= 20f; speed += 1f)
                    for (var jump = 1.5f; jump <= 5f; jump += 0.5f)
                    {
                        var tuning = T(speed, jump, spacing);
                        if (Winnability.Check(tuning) == null) yield return tuning;
                    }
        }

        [Test]
        public void Default_tuning_is_playable() => Assert.IsNull(Winnability.Check(T(6f, 2.2f, 12f)));

        [TestCase(1f, 1.5f, 4f)]  // the old range minimum: no take-off frame clears an obstacle
        [TestCase(1f, 5f, 40f)]
        [TestCase(2f, 2.2f, 12f)]
        [TestCase(3f, 2.2f, 12f)] // only about two frames at 60 fps would clear it
        public void A_jump_that_stays_over_an_obstacle_too_briefly_is_rejected(float speed, float jump, float spacing)
        {
            StringAssert.Contains("jumpHeight", Winnability.Check(T(speed, jump, spacing)));
        }

        [TestCase(20f, 1.5f, 4f)] // the first obstacle can be cleared, the second cannot
        [TestCase(20f, 1.5f, 6f)]
        [TestCase(20f, 5f, 4f)]
        public void Spacing_too_short_to_land_and_jump_again_is_rejected(float speed, float jump, float spacing)
        {
            StringAssert.Contains("obstacleSpacing", Winnability.Check(T(speed, jump, spacing)));
        }

        [Test]
        public void The_message_names_a_value_that_is_accepted()
        {
            var jumpMessage = Winnability.Check(T(3f, 2.2f, 12f));
            StringAssert.Contains("at least 3.1", jumpMessage);
            Assert.IsNull(Winnability.Check(T(3f, 3.1f, 12f)));

            var spacingMessage = Winnability.Check(T(20f, 5f, 4f));
            StringAssert.Contains("at least 27.1", spacingMessage);
            Assert.IsNull(Winnability.Check(T(20f, 5f, 27.1f)));
        }

        [Test]
        public void Accepted_tunings_leave_the_player_a_timing_window()
        {
            // The simulator is the judge: count the take-off frames (at 120 Hz) that clear the first obstacle.
            var checkedAny = 0;
            foreach (var tuning in AcceptedGrid())
            {
                var idealTakeOffTime = (RunnerSim.FirstSpawnZ - tuning.speed * Mathf.Sqrt(2f * tuning.jumpHeight / RunnerSim.Gravity)) / tuning.speed;
                var first = Mathf.Max(0, Mathf.FloorToInt((idealTakeOffTime - 0.6f) / Step));
                var survived = 0;
                for (var k = first; k <= first + Mathf.CeilToInt(1.2f / Step); k++)
                    if (SurvivesFirstObstacle(tuning, k)) survived++;

                // A window of Winnability.MinTimingWindow, less one frame at each end for the discrete steps.
                Assert.GreaterOrEqual(survived * Step, Winnability.MinTimingWindow - 2f * Step,
                    $"speed {tuning.speed}, jumpHeight {tuning.jumpHeight}, spacing {tuning.obstacleSpacing}: {survived} frames work");
                checkedAny++;
            }
            Assert.Greater(checkedAny, 100);
        }

        [Test]
        public void A_bot_that_is_a_little_early_or_late_survives_every_accepted_tuning()
        {
            foreach (var tuning in AcceptedGrid())
                foreach (var error in new[] { -0.08f, 0f, 0.08f })
                {
                    var sim = new RunnerSim(tuning);
                    for (var i = 0; i < 30 * 120 && !sim.GameOver; i++) sim.Tick(Step, BotJumps(sim, tuning, error));
                    Assert.IsFalse(sim.GameOver,
                        $"speed {tuning.speed}, jumpHeight {tuning.jumpHeight}, spacing {tuning.obstacleSpacing}, timing error {error} s: died at Z={sim.Z}");
                }
        }

        static bool SurvivesFirstObstacle(Tuning tuning, int takeOffFrame)
        {
            var sim = new RunnerSim(tuning);
            for (var i = 0; !sim.GameOver && sim.Z < RunnerSim.FirstSpawnZ + RunnerSim.HitHalfWidth + 0.5f; i++)
                sim.Tick(Step, i == takeOffFrame);
            return !sim.GameOver;
        }

        // Jumps for the next obstacle when the hero is on the ground and close enough that the apex falls on it, shifted by error seconds.
        static bool BotJumps(RunnerSim sim, Tuning tuning, float error)
        {
            if (!sim.Grounded) return false;
            var takeOffDistance = tuning.speed * (Mathf.Sqrt(2f * tuning.jumpHeight / RunnerSim.Gravity) + error);
            foreach (var e in sim.Entities)
            {
                if (e.Kind != EntityKind.Obstacle || e.Z <= sim.Z) continue;
                return e.Z - sim.Z <= takeOffDistance;
            }
            return false;
        }
    }
}
