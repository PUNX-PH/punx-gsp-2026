using System.Collections.Generic;
using System.Linq;
using NUnit.Framework;
using Runner.Scripting;

namespace Runner.Tests
{
    /// <summary>The script world: movement, gravity, life, collisions between solid objects, exits, the caps, and that destroying is safe at any time.</summary>
    public class ScriptWorldTests
    {
        const double Frame = 1.0 / 60.0;

        static List<WorldEvent> Run(ScriptWorld world, int frames)
        {
            var all = new List<WorldEvent>();
            for (var i = 0; i < frames; i++) world.Step(Frame, all);
            return all;
        }

        [Test]
        public void SpawnGivesDistinctObjectsWithDefaults()
        {
            var world = new ScriptWorld();
            var a = world.Spawn("box");
            var b = world.Spawn("sphere");
            Assert.AreNotEqual(a.Id, b.Id);
            Assert.IsTrue(a.Alive);
            Assert.AreEqual("box", a.Kind);
            Assert.AreEqual(1.0, a.W);
            Assert.AreEqual(1.0, a.H);
            Assert.IsFalse(a.Solid);
            Assert.IsFalse(a.Gravity);
            Assert.AreEqual(2, world.Count());
        }

        [Test]
        public void VelocityMovesAnObjectEveryStep()
        {
            var world = new ScriptWorld();
            var o = world.Spawn("box");
            o.Vx = 2;
            o.Vy = -1;
            Run(world, 60);
            Assert.AreEqual(2.0, o.X, 1e-6);
            Assert.AreEqual(-1.0, o.Y, 1e-6);
        }

        [Test]
        public void GravityPullsDownOnlyObjectsThatAskForIt()
        {
            var world = new ScriptWorld { Gravity = 10 };
            var falls = world.Spawn("box");
            falls.Gravity = true;
            var floats = world.Spawn("box");
            Run(world, 60);
            Assert.AreEqual(-10.0, falls.Vy, 1e-6);
            Assert.AreEqual(-5.0, falls.Y, 0.1);
            Assert.AreEqual(0.0, floats.Y);
            Assert.AreEqual(0.0, floats.Vy);
        }

        [Test]
        public void SpinTurnsAnObject()
        {
            var world = new ScriptWorld();
            var o = world.Spawn("box");
            o.Spin = 90;
            Run(world, 60);
            Assert.AreEqual(90.0, o.Angle, 1e-6);
        }

        [Test]
        public void LifeExpiresWithoutAnEvent()
        {
            var world = new ScriptWorld();
            var o = world.Spawn("box");
            o.Life = 0.5;
            var events = Run(world, 29);
            Assert.IsTrue(o.Alive);
            events.AddRange(Run(world, 3));
            Assert.IsFalse(o.Alive);
            Assert.AreEqual(0, world.Count());
            Assert.AreEqual(0, events.Count);
        }

        static ScriptObject Solid(ScriptWorld world, double x, double y, string kind = "box", string tag = null)
        {
            var o = world.Spawn(kind);
            o.X = x;
            o.Y = y;
            o.Solid = true;
            o.Tag = tag;
            return o;
        }

        [Test]
        public void AnOverlappingSolidPairRaisesOneCollisionUntilTheySeparate()
        {
            var world = new ScriptWorld();
            var a = Solid(world, 0, 0);
            var b = Solid(world, 0.5, 0);
            var events = Run(world, 10);
            Assert.AreEqual(1, events.Count(e => e.Kind == WorldEventKind.Collide));
            Assert.AreSame(a, events[0].A);
            Assert.AreSame(b, events[0].B);

            b.X = 5;
            Assert.AreEqual(0, Run(world, 3).Count);
            b.X = 0.5;
            Assert.AreEqual(1, Run(world, 3).Count(e => e.Kind == WorldEventKind.Collide));
        }

        [Test]
        public void TouchingEdgesCount()
        {
            var world = new ScriptWorld();
            Solid(world, 0, 0);
            Solid(world, 1, 0);
            Assert.AreEqual(1, Run(world, 1).Count);
        }

        [Test]
        public void ObjectsThatAreNotBothSolidDoNotCollide()
        {
            var world = new ScriptWorld();
            var a = Solid(world, 0, 0);
            var b = Solid(world, 0, 0);
            var c = Solid(world, 0, 0);
            b.Solid = false;
            c.Solid = false;
            Assert.AreEqual(0, Run(world, 3).Count, "only a is solid");
            a.Solid = true;
            b.Solid = true;
            Assert.AreEqual(1, Run(world, 3).Count, "a and b are solid now, c still is not");
        }

        [Test]
        public void ThreeOverlappingSolidsRaiseThreePairs()
        {
            var world = new ScriptWorld();
            Solid(world, 0, 0);
            Solid(world, 0.1, 0);
            Solid(world, 0.2, 0);
            Assert.AreEqual(3, Run(world, 5).Count(e => e.Kind == WorldEventKind.Collide));
        }

        [Test]
        public void SpheresUseTheirCircleNotTheirCorners()
        {
            var world = new ScriptWorld();
            Solid(world, 0, 0, "sphere");
            Solid(world, 0.9, 0.9, "sphere");
            Assert.AreEqual(0, Run(world, 3).Count, "the boxes overlap at the corner but the circles do not");
            var near = new ScriptWorld();
            Solid(near, 0, 0, "sphere");
            Solid(near, 0.6, 0.6, "sphere");
            Assert.AreEqual(1, Run(near, 3).Count);
        }

        [Test]
        public void ADestroyedObjectNoLongerCollides()
        {
            var world = new ScriptWorld();
            var a = Solid(world, 0, 0);
            Solid(world, 0.5, 0);
            a.Destroy();
            Assert.AreEqual(0, Run(world, 3).Count);
        }

        [Test]
        public void AnObjectThatLeavesTheFieldRaisesOneExit()
        {
            var world = new ScriptWorld();
            world.SetBounds(10, 10);
            var o = world.Spawn("box");
            o.Vx = 5;
            var events = Run(world, 240);
            Assert.AreEqual(1, events.Count(e => e.Kind == WorldEventKind.Exit));
            Assert.AreSame(o, events.First(e => e.Kind == WorldEventKind.Exit).A);
            Assert.IsTrue(o.Alive, "leaving does not remove it: the script decides");
        }

        [Test]
        public void ExitComesOnlyAfterTheObjectWasInsideAndAgainAfterItReturns()
        {
            var world = new ScriptWorld();
            world.SetBounds(10, 10);
            var o = world.Spawn("box");
            o.Y = 20;
            Assert.AreEqual(0, Run(world, 5).Count, "spawned outside is not an exit");
            o.Y = 0;
            Run(world, 2);
            o.Y = 20;
            Assert.AreEqual(1, Run(world, 2).Count(e => e.Kind == WorldEventKind.Exit));
            Assert.AreEqual(0, Run(world, 5).Count, "still outside: no second event");
            o.Y = 0;
            Run(world, 2);
            o.Y = -20;
            Assert.AreEqual(1, Run(world, 2).Count(e => e.Kind == WorldEventKind.Exit));
        }

        [Test]
        public void TheFieldIsCenteredOnTheOrigin()
        {
            var world = new ScriptWorld();
            Assert.AreEqual(9.0, world.Width);
            Assert.AreEqual(16.0, world.Height);
            var o = world.Spawn("box");
            o.X = 4;
            Assert.AreEqual(0, Run(world, 2).Count, "a box at x=4 still touches a field that reaches 4.5");
            o.X = 5.1;
            Assert.AreEqual(1, Run(world, 2).Count(e => e.Kind == WorldEventKind.Exit));
        }

        [Test]
        public void SetBoundsRefusesNonsense()
        {
            var world = new ScriptWorld();
            Assert.IsTrue(world.SetBounds(20, 30));
            Assert.AreEqual(20.0, world.Width);
            foreach (var bad in new[] { 0.0, -1.0, double.NaN, double.PositiveInfinity })
            {
                Assert.IsFalse(world.SetBounds(bad, 10));
                Assert.IsFalse(world.SetBounds(10, bad));
            }
            Assert.AreEqual(20.0, world.Width);
            Assert.AreEqual(30.0, world.Height);
        }

        [Test]
        public void ObjectCapDropsSpawnsAndCountsThem()
        {
            var world = new ScriptWorld();
            for (var batch = 0; batch < 3; batch++)
            {
                for (var i = 0; i < 100; i++) world.Spawn("box");
                Run(world, 61); // the spawn-rate cap is a separate limit: let a second pass so it does not interfere
            }
            Assert.AreEqual(0, world.DroppedSpawns);
            var extra = world.Spawn("box");
            Assert.AreEqual(ScriptWorld.MaxObjects, world.Count());
            Assert.IsFalse(extra.Alive, "a dropped spawn is a dead stand-in, so the script's next lines do not crash");
            extra.X = 3;
            extra.Vx = 2;
            Assert.IsTrue(world.DroppedSpawns >= 1);
            Assert.AreEqual(ScriptWorld.MaxObjects, world.Objects.Count(o => o.Alive));
        }

        [Test]
        public void SpawnRateCapLimitsASecondAndResets()
        {
            var world = new ScriptWorld();
            var made = new List<ScriptObject>();
            for (var i = 0; i < ScriptWorld.MaxSpawnsPerSecond + 30; i++)
            {
                var o = world.Spawn("box");
                if (o.Alive) made.Add(o);
                o.Destroy();
            }
            Assert.AreEqual(ScriptWorld.MaxSpawnsPerSecond, made.Count);
            Assert.AreEqual(30, world.DroppedSpawns);
            Run(world, 61);
            Assert.IsTrue(world.Spawn("box").Alive, "a new second allows spawns again");
        }

        [Test]
        public void FreeingSlotsAllowsMoreSpawns()
        {
            var world = new ScriptWorld();
            var made = new List<ScriptObject>();
            for (var round = 0; round < 3; round++)
            {
                for (var i = 0; i < 100; i++) made.Add(world.Spawn("box"));
                Run(world, 61);
                foreach (var o in made) o.Destroy();
                made.Clear();
                Run(world, 1);
            }
            Assert.AreEqual(0, world.Count());
            Assert.AreEqual(0, world.DroppedSpawns);
        }

        [Test]
        public void DestroyIsSafeInsideACallbackAndTwice()
        {
            var world = new ScriptWorld();
            var a = Solid(world, 0, 0, "box", "enemy");
            var b = Solid(world, 0.2, 0, "box", "enemy");
            var events = Run(world, 2);
            Assert.AreEqual(1, events.Count);
            var found = world.Find("enemy");
            foreach (var o in found) o.Destroy();
            a.Destroy();
            Assert.AreEqual(0, world.Count("enemy"));
            Assert.AreEqual(0, world.Count());
            Assert.IsFalse(b.Alive);
            Assert.AreEqual(0, Run(world, 2).Count);
        }

        [Test]
        public void ADestroyedObjectCanStillBeReadAndWrittenWithoutHarm()
        {
            var world = new ScriptWorld();
            var o = world.Spawn("box");
            o.Destroy();
            o.X = 3;
            o.Vx = 5;
            Run(world, 5);
            Assert.IsFalse(o.Alive);
            Assert.AreEqual(0, world.Count());
        }

        [Test]
        public void FindAndCountKeepSpawnOrderAndSkipTheDead()
        {
            var world = new ScriptWorld();
            var a = world.Spawn("box");
            a.Tag = "coin";
            var b = world.Spawn("box");
            b.Tag = "rock";
            var c = world.Spawn("box");
            c.Tag = "coin";
            Assert.AreEqual(new[] { a, c }, world.Find("coin"));
            Assert.AreEqual(2, world.Count("coin"));
            a.Destroy();
            Assert.AreEqual(new[] { c }, world.Find("coin"));
            Assert.AreEqual(1, world.Count("coin"));
            Assert.AreEqual(0, world.Find("none").Count);
            Assert.AreEqual(0, world.Count(null));
        }

        [Test]
        public void ClearRemovesEverythingAndTheWorldKeepsWorking()
        {
            var world = new ScriptWorld();
            for (var i = 0; i < 50; i++) world.Spawn("box");
            world.Clear();
            Assert.AreEqual(0, world.Count());
            Assert.IsTrue(world.Spawn("box").Alive);
            Assert.AreEqual(1, world.Count());
        }

        [Test]
        public void NonNumbersAreReplacedSoTheViewNeverGetsThem()
        {
            var world = new ScriptWorld();
            var o = world.Spawn("box");
            o.X = double.NaN;
            o.Y = double.PositiveInfinity;
            o.Vx = double.NegativeInfinity;
            o.W = double.NaN;
            Run(world, 2);
            Assert.IsFalse(double.IsNaN(o.X) || double.IsInfinity(o.X));
            Assert.IsFalse(double.IsNaN(o.Y) || double.IsInfinity(o.Y));
            Assert.IsFalse(double.IsNaN(o.Vx) || double.IsInfinity(o.Vx));
            Assert.IsFalse(double.IsNaN(o.W) || double.IsInfinity(o.W));
        }

        [Test]
        public void DistanceIsStraightLine()
        {
            var world = new ScriptWorld();
            var a = world.Spawn("box");
            var b = world.Spawn("box");
            b.X = 3;
            b.Y = 4;
            Assert.AreEqual(5.0, a.Distance(b), 1e-9);
            Assert.AreEqual(5.0, b.Distance(a), 1e-9);
        }

        [Test]
        public void TimeCountsStepsAndSurvivesNothingElse()
        {
            var world = new ScriptWorld();
            Run(world, 90);
            Assert.AreEqual(1.5, world.Time, 1e-6);
        }
    }
}
