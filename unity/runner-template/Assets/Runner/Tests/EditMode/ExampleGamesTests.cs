using System;
using System.IO;
using System.Linq;
using System.Text;
using NUnit.Framework;
using Runner.Scripting;
using UnityEngine;

namespace Runner.Tests
{
    /// <summary>
    /// The example games (Tests/Scripts/*.lua) played end to end: with no input, with a bot that plays well, and with random input. Their end states
    /// are pinned, so a change to the world, the API or the runner that changes how a game plays shows up here.
    /// </summary>
    public class ExampleGamesTests
    {
        const double Frame = 1.0 / 60.0;

        delegate PointerState Driver(ScriptRunner runner, PointerState previous);

        sealed class Result
        {
            public int Frames;
            public GameOutcome Outcome;
            public double Score;
            public double Lives;
            public string Message;
            public string Error;
            public override string ToString() => $"frames={Frames} outcome={Outcome} score={Score} lives={Lives} message='{Message}' error='{Error}'";
        }

        static string Source(string name) => File.ReadAllText(Path.Combine(Application.dataPath, "Runner", "Tests", "Scripts", name + ".lua"));

        static Result Play(string name, uint seed, Driver driver, int maxFrames = 4000)
        {
            var runner = new ScriptRunner(Source(name), seed);
            Assert.IsTrue(runner.Start(), runner.Error);
            var pointer = default(PointerState);
            var frames = 0;
            while (frames < maxFrames && !runner.Over && !runner.Failed)
            {
                pointer = driver(runner, pointer);
                runner.Step(Frame, pointer);
                frames++;
            }
            return new Result { Frames = frames, Outcome = runner.Api.Outcome, Score = runner.Api.Score, Lives = runner.Api.Lives, Message = runner.Api.Message, Error = runner.Error };
        }

        static PointerState Idle(ScriptRunner r, PointerState p) => new PointerState(0, 0, false);

        static ScriptObject[] With(ScriptRunner r, string tag) => r.World.Objects.Where(o => o.Alive && o.Tag == tag).ToArray();

        // ---- the lane runner

        static PointerState RunnerBot(ScriptRunner r, PointerState p)
        {
            var player = With(r, "player").Single();
            var rocks = With(r, "rock");
            bool Blocked(double lane) => rocks.Any(o => Math.Abs(o.X - lane) < 1.0 && o.Y > -8 && o.Y < 5);
            var want = false;
            var target = player.X;
            if (Blocked(player.X))
            {
                var lanes = new[] { -2.5, 0.0, 2.5 };
                var free = lanes.Where(l => !Blocked(l)).OrderBy(l => Math.Abs(l - player.X)).ToArray();
                if (free.Length > 0)
                {
                    target = free[0];
                    want = Math.Abs(target - player.X) > 0.1;
                }
            }
            if (!want || p.Down) return new PointerState(0, 0, false);
            return new PointerState(target > player.X ? 1 : -1, 0, true);
        }

        [Test]
        public void RunnerWithNoInputLosesItsLives()
        {
            var result = Play("runner", 1, Idle);
            Assert.AreEqual("frames=487 outcome=Lost score=6 lives=0 message='You crashed' error=''", result.ToString());
        }

        [Test]
        public void RunnerWithABotSurvivesAndWins()
        {
            var result = Play("runner", 1, RunnerBot);
            Assert.AreEqual("frames=1802 outcome=Won score=40 lives=3 message='You made it!' error=''", result.ToString());
        }

        // ---- the flier

        static PointerState FlierBot(ScriptRunner r, PointerState p)
        {
            var bird = With(r, "bird").Single();
            var tops = With(r, "pipe").Where(o => o.X > bird.X - 1.2).OrderBy(o => o.X).ToArray();
            var aim = 0.0;
            if (tops.Length > 0)
            {
                var top = tops[0];
                var low = With(r, "pipe_low").Where(o => Math.Abs(o.X - top.X) < 0.01).FirstOrDefault();
                if (low != null) aim = ((top.Y - top.H / 2) + (low.Y + low.H / 2)) / 2;
            }
            var flap = bird.Y < aim - 0.4 && bird.Vy <= 1.0;
            return flap && !p.Down ? new PointerState(0, 0, true) : new PointerState(0, 0, false);
        }

        [Test]
        public void FlierWithNoInputFallsAndLoses()
        {
            var result = Play("flier", 1, Idle);
            Assert.AreEqual("frames=50 outcome=Lost score=0 lives=3 message='You hit the edge' error=''", result.ToString());
        }

        [Test]
        public void FlierWithABotFliesThroughTenPipes()
        {
            var result = Play("flier", 1, FlierBot, 6000);
            Assert.AreEqual("frames=1112 outcome=Won score=10 lives=3 message='You flew through!' error=''", result.ToString());
        }

        // ---- the catcher

        static PointerState CatcherBot(ScriptRunner r, PointerState p)
        {
            var basket = With(r, "basket").Single();
            var bombs = With(r, "bomb");
            // the basket sits under the apple it is catching, so skip an apple that has a bomb below it in its column
            var apples = With(r, "apple").Where(a => !bombs.Any(b => b.Y < a.Y + 0.5 && Math.Abs(b.X - a.X) < 1.7)).OrderBy(o => o.Y).ToArray();
            var x = apples.Length > 0 ? apples[0].X : basket.X;
            return new PointerState(x, 0, true);
        }

        [Test]
        public void CatcherWithNoInputMissesTheApplesAndLoses()
        {
            var result = Play("catcher", 1, Idle);
            Assert.AreEqual("frames=603 outcome=Lost score=2 lives=0 message='Out of lives' error=''", result.ToString());
        }

        [Test]
        public void CatcherWithABotCatchesTheApples()
        {
            var result = Play("catcher", 1, CatcherBot, 6000);
            Assert.AreEqual("frames=1419 outcome=Won score=15 lives=1 message='All caught!' error=''", result.ToString());
        }

        // ---- every game, random input

        [TestCase("runner")]
        [TestCase("flier")]
        [TestCase("catcher")]
        public void RandomInputNeverBreaksAGame(string name)
        {
            for (uint seed = 1; seed <= 5; seed++)
            {
                var random = new System.Random((int)seed);
                var result = Play(name, seed, (r, p) => new PointerState(random.NextDouble() * 9 - 4.5, random.NextDouble() * 16 - 8, random.NextDouble() < 0.5), 3600);
                Assert.IsNull(result.Error, name + " seed " + seed + ": " + result.Error);
            }
        }

        [TestCase("runner")]
        [TestCase("flier")]
        [TestCase("catcher")]
        public void AGamePlaysTheSameWayTwice(string name)
        {
            Result Run()
            {
                var random = new System.Random(3);
                return Play(name, 9, (r, p) => new PointerState(random.NextDouble() * 9 - 4.5, 0, random.NextDouble() < 0.3), 1500);
            }
            Assert.AreEqual(Run().ToString(), Run().ToString());
        }

        [Test]
        public void EveryExampleGameFileIsCovered()
        {
            var dir = Path.Combine(Application.dataPath, "Runner", "Tests", "Scripts");
            var names = Directory.GetFiles(dir, "*.lua").Select(Path.GetFileNameWithoutExtension).OrderBy(n => n).ToArray();
            Assert.AreEqual(new[] { "catcher", "flier", "runner" }, names, "add the game to this test class when adding a file");
            Assert.IsNotNull(new StringBuilder());
        }
    }
}
