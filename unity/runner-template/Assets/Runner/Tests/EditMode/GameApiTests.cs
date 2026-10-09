using System;
using System.Linq;
using NUnit.Framework;
using Runner.Scripting;

namespace Runner.Tests
{
    /// <summary>The game API a script sees (game, world, objects, input, ui, timer, rand) and the runner that plays a script.</summary>
    public class GameApiTests
    {
        const double Frame = 1.0 / 60.0;

        static ScriptRunner Begin(string source, uint seed = 1, Func<double> clock = null)
        {
            var runner = new ScriptRunner(source, seed, clock);
            Assert.IsTrue(runner.Start(), runner.Error);
            return runner;
        }

        static void Play(ScriptRunner runner, int frames, PointerState pointer = default)
        {
            for (var i = 0; i < frames; i++) Assert.IsTrue(runner.Step(Frame, pointer), runner.Error);
        }

        static string Text(ScriptRunner r, string name)
        {
            var v = r.Host.Lua.Globals.Get(name);
            return v.IsNil() ? null : v.ToPrintString();
        }

        static double Num(ScriptRunner r, string name) => r.Host.Lua.Globals.Get(name).Number;

        /// <summary>Runs a script until it fails and returns the error (the test fails if it never does).</summary>
        static string FailureOf(string source, int frames = 3)
        {
            var runner = new ScriptRunner(source);
            if (!runner.Start()) return runner.Error;
            for (var i = 0; i < frames; i++)
                if (!runner.Step(Frame, default)) return runner.Error;
            Assert.Fail("the script was expected to fail");
            return null;
        }

        // ---- game

        [Test]
        public void ScoreAndLivesAreReadAndWrittenByTheScript()
        {
            var r = Begin("function init() game.score = 5 game.lives = game.lives - 1 end function update(dt) game.score = game.score + 1 end");
            Assert.AreEqual(5.0, r.Api.Score);
            Assert.AreEqual(2.0, r.Api.Lives);
            Play(r, 10);
            Assert.AreEqual(15.0, r.Api.Score);
        }

        [Test]
        public void ScoreMustStayANumber()
        {
            StringAssert.Contains("game.score must be a number", FailureOf("function init() game.score = 'lots' end"));
            StringAssert.Contains("game.lives must be a number", FailureOf("function update(dt) game.lives = nil end"));
        }

        [Test]
        public void GameWinEndsTheGameOnceWithItsMessageAndNothingRunsAfter()
        {
            var r = Begin("n = 0 function update(dt) n = n + 1 if n == 3 then game.win('Well done') game.lose('too late') end end");
            Play(r, 10);
            Assert.AreEqual(GameOutcome.Won, r.Api.Outcome);
            Assert.AreEqual("Well done", r.Api.Message);
            Assert.IsTrue(r.Over);
            Assert.AreEqual(3.0, Num(r, "n"), "no update after the game ended");
        }

        [Test]
        public void GameLoseEndsTheGame()
        {
            var r = Begin("function init() game.lose() end");
            Assert.AreEqual(GameOutcome.Lost, r.Api.Outcome);
            Assert.AreEqual("", r.Api.Message);
            Assert.IsTrue(r.Step(Frame, default));
        }

        [Test]
        public void GameTimeWidthHeightAndOverAreReadOnlyValuesTheScriptCanRead()
        {
            var r = Begin("w = game.width h = game.height o = game.over function update(dt) t = game.time o2 = game.over end");
            Assert.AreEqual(9.0, Num(r, "w"));
            Assert.AreEqual(16.0, Num(r, "h"));
            Assert.AreEqual("false", Text(r, "o"));
            Play(r, 60);
            Assert.AreEqual(1.0, Num(r, "t"), 0.05);
            Assert.AreEqual("false", Text(r, "o2"));
        }

        [Test]
        public void GameOverIsTrueOnceTheGameHasEnded()
        {
            var r = Begin("function init() game.win() seen = game.over end");
            Assert.AreEqual("true", Text(r, "seen"));
        }

        // ---- world

        [Test]
        public void SpawnAppliesPropsAndReturnsAnObject()
        {
            var r = Begin(@"
                function init()
                  o = world.spawn('box', { x = 1, y = 2, z = 3, w = 4, h = 5, d = 6, vx = 7, vy = 8, vz = 9, color = 3, tag = 'hero', gravity = true, solid = true, life = 10, spin = 45 })
                end");
            var o = r.World.Objects.Single();
            Assert.AreEqual("box", o.Kind);
            Assert.AreEqual(new[] { 1.0, 2, 3, 4, 5, 6, 7, 8, 9 }, new[] { o.X, o.Y, o.Z, o.W, o.H, o.D, o.Vx, o.Vy, o.Vz });
            Assert.AreEqual("3", o.Color);
            Assert.AreEqual("hero", o.Tag);
            Assert.IsTrue(o.Gravity);
            Assert.IsTrue(o.Solid);
            Assert.AreEqual(10.0, o.Life);
            Assert.AreEqual(45.0, o.Spin);
        }

        [Test]
        public void SpawnChecksItsArguments()
        {
            StringAssert.Contains("world.spawn: kind must be a string", FailureOf("function init() world.spawn() end"));
            StringAssert.Contains("world.spawn: props must be a table", FailureOf("function init() world.spawn('box', 5) end"));
            StringAssert.Contains("world.spawn: x must be a number", FailureOf("function init() world.spawn('box', { x = 'left' }) end"));
            StringAssert.Contains("world.spawn: color must be a palette slot", FailureOf("function init() world.spawn('box', { color = 'red' }) end"));
        }

        [Test]
        public void SpawnedKindsAndNamesAreLimitedInLength()
        {
            StringAssert.Contains("too long", FailureOf("function init() world.spawn(string.rep('a', 200)) end"));
            StringAssert.Contains("too long", FailureOf("function init() world.spawn('box', { tag = string.rep('a', 200) }) end"));
        }

        [Test]
        public void FindAndCountSeeOnlyLiveObjectsWithTheTag()
        {
            var r = Begin(@"
                function init()
                  a = world.spawn('box', { tag = 'coin' })
                  world.spawn('box', { tag = 'rock' })
                  world.spawn('box', { tag = 'coin' })
                  before = world.count('coin')
                  a:destroy()
                  after = world.count('coin')
                  list = world.find('coin')
                  listed = #list
                  none = #world.find('nothing')
                  total = world.count()
                end");
            Assert.AreEqual(2.0, Num(r, "before"));
            Assert.AreEqual(1.0, Num(r, "after"));
            Assert.AreEqual(1.0, Num(r, "listed"));
            Assert.AreEqual(0.0, Num(r, "none"));
            Assert.AreEqual(0.0, Num(r, "total"), "count without a tag is 0 (use find or count with a tag)");
        }

        [Test]
        public void FindReturnsTheSameObjectsInSpawnOrder()
        {
            var r = Begin(@"
                function init()
                  a = world.spawn('box', { tag = 't', x = 1 })
                  b = world.spawn('box', { tag = 't', x = 2 })
                  local list = world.find('t')
                  first = list[1] == a
                  second = list[2] == b
                  firstx = list[1].x
                end");
            Assert.AreEqual("true", Text(r, "first"));
            Assert.AreEqual("true", Text(r, "second"));
            Assert.AreEqual(1.0, Num(r, "firstx"));
        }

        [Test]
        public void ClearRemovesEveryObject()
        {
            var r = Begin("function init() for i = 1, 5 do world.spawn('box') end world.clear() end");
            Assert.AreEqual(0, r.World.Count());
        }

        [Test]
        public void GravityAndBoundsAreSet()
        {
            var r = Begin("function init() world.gravity(5) world.bounds(30, 20) w = game.width end");
            Assert.AreEqual(5.0, r.World.Gravity);
            Assert.AreEqual(30.0, r.World.Width);
            Assert.AreEqual(20.0, r.World.Height);
            Assert.AreEqual(30.0, Num(r, "w"));
            StringAssert.Contains("world.bounds: w and h must be numbers above 0", FailureOf("function init() world.bounds(0, 5) end"));
            StringAssert.Contains("world.gravity: g must be a number", FailureOf("function init() world.gravity('down') end"));
        }

        [Test]
        public void CameraTakesAModeAFollowTargetAPositionAndAZoomAndMerges()
        {
            var r = Begin(@"
                function init()
                  hero = world.spawn('box')
                  world.camera{ mode = 'chase', follow = hero, x = 1, y = 2, z = 3, zoom = 2 }
                  world.camera{ zoom = 4 }
                end");
            Assert.AreEqual("chase", r.Api.Camera.Mode);
            Assert.AreSame(r.World.Objects[0], r.Api.Camera.Follow);
            Assert.AreEqual(new[] { 1.0, 2, 3, 4 }, new[] { r.Api.Camera.X, r.Api.Camera.Y, r.Api.Camera.Z, r.Api.Camera.Zoom });
            var stop = Begin("function init() hero = world.spawn('box') world.camera{ follow = hero } world.camera{ follow = false } end");
            Assert.IsNull(stop.Api.Camera.Follow);
        }

        [TestCase("side")]
        [TestCase("top")]
        [TestCase("chase")]
        [TestCase("fixed")]
        [TestCase("first")]
        [TestCase("side2d")]
        [TestCase("top2d")]
        public void EveryCameraModeIsAccepted(string mode)
        {
            Assert.AreEqual(mode, Begin("function init() world.camera{ mode = '" + mode + "' } end").Api.Camera.Mode);
        }

        [Test]
        public void CameraRefusesBadInput()
        {
            StringAssert.Contains("world.camera: mode must be one of", FailureOf("function init() world.camera{ mode = 'sideways' } end"));
            StringAssert.Contains("world.camera: call it with a table", FailureOf("function init() world.camera('side') end"));
            StringAssert.Contains("world.camera: follow must be an object", FailureOf("function init() world.camera{ follow = 5 } end"));
        }

        // ---- objects

        [Test]
        public void ObjectFieldsReadAndWrite()
        {
            var r = Begin(@"
                function init()
                  o = world.spawn('box', { x = 1 })
                  o.x = o.x + 4
                  o.vy = -2
                  o.tag = 'enemy'
                  o.color = '#FF8800'
                  o.solid = true
                  o.life = nil
                  readx = o.x
                  readtag = o.tag
                  readcolor = o.color
                  readalive = o.alive
                  readkind = o.kind
                end");
            var o = r.World.Objects.Single();
            Assert.AreEqual(5.0, o.X);
            Assert.AreEqual(-2.0, o.Vy);
            Assert.AreEqual("enemy", o.Tag);
            Assert.AreEqual("#ff8800", o.Color);
            Assert.IsTrue(o.Solid);
            Assert.AreEqual(5.0, Num(r, "readx"));
            Assert.AreEqual("enemy", Text(r, "readtag"));
            Assert.AreEqual("#ff8800", Text(r, "readcolor"));
            Assert.AreEqual("true", Text(r, "readalive"));
            Assert.AreEqual("box", Text(r, "readkind"));
        }

        [Test]
        public void ObjectFieldsCheckTheirTypes()
        {
            StringAssert.Contains("obj: x must be a number", FailureOf("function init() o = world.spawn('box') o.x = 'far' end"));
            StringAssert.Contains("obj: tag must be a string", FailureOf("function init() o = world.spawn('box') o.tag = 5 end"));
            StringAssert.Contains("obj: color must be a palette slot", FailureOf("function init() o = world.spawn('box') o.color = 9 end"));
            StringAssert.Contains("obj: data must be a table", FailureOf("function init() o = world.spawn('box') o.data = 5 end"));
        }

        [Test]
        public void AliveIdAndKindAreReadOnly()
        {
            StringAssert.Contains("alive is read only", FailureOf("function init() o = world.spawn('box') o.alive = false end"));
            StringAssert.Contains("id is read only", FailureOf("function init() o = world.spawn('box') o.id = 4 end"));
            StringAssert.Contains("kind is read only", FailureOf("function init() o = world.spawn('box') o.kind = 'sphere' end"));
        }

        [Test]
        public void AFieldTheScriptInventsLivesInData()
        {
            var r = Begin(@"
                function init()
                  o = world.spawn('box')
                  o.hp = 3
                  o.data.mood = 'calm'
                  o[1] = 'first'
                  hp = o.hp
                  viaData = o.data.hp
                  mood = o.mood
                  first = o[1]
                  missing = o.nothing
                end");
            Assert.AreEqual(3.0, Num(r, "hp"));
            Assert.AreEqual(3.0, Num(r, "viaData"));
            Assert.AreEqual("calm", Text(r, "mood"));
            Assert.AreEqual("first", Text(r, "first"));
            Assert.IsNull(Text(r, "missing"));
        }

        [Test]
        public void ObjectMethodsCannotBeReplacedAndDataCanBeReplacedByATable()
        {
            StringAssert.Contains("method", FailureOf("function init() o = world.spawn('box') o.destroy = 5 end"));
            var r = Begin("function init() o = world.spawn('box') o.data = { a = 1 } v = o.a end");
            Assert.AreEqual(1.0, Num(r, "v"));
        }

        [Test]
        public void DestroySetColorPlayAndDistanceWork()
        {
            var r = Begin(@"
                function init()
                  a = world.spawn('box')
                  b = world.spawn('box', { x = 3, y = 4 })
                  d = a:distance(b)
                  b:set_color(2)
                  b:play('walk')
                  a:destroy()
                  gone = a.alive
                  count = world.count('x')
                end");
            Assert.AreEqual(5.0, Num(r, "d"));
            Assert.AreEqual("false", Text(r, "gone"));
            var b = r.World.Objects.Single(o => o.Alive);
            Assert.AreEqual("2", b.Color);
            Assert.AreEqual("walk", b.Animation);
        }

        [Test]
        public void MethodsNeedAnObjectAndAColon()
        {
            StringAssert.Contains("call it on an object with a colon", FailureOf("function init() o = world.spawn('box') o.destroy() end"));
            StringAssert.Contains("expected an object", FailureOf("function init() o = world.spawn('box') o:distance(5) end"));
            StringAssert.Contains("obj:set_color: color must be a palette slot", FailureOf("function init() o = world.spawn('box') o:set_color('green') end"));
        }

        [Test]
        public void ADestroyedObjectCanStillBeUsedByTheScript()
        {
            var r = Begin("function init() o = world.spawn('box') o:destroy() o.x = 4 o.hp = 1 v = o.x o:destroy() end");
            Assert.AreEqual(4.0, Num(r, "v"));
            Assert.AreEqual(0, r.World.Count());
        }

        [Test]
        public void ErrorsInTheApiCarryTheLineOfTheScript()
        {
            var error = FailureOf("function init()\n  local o = world.spawn('box')\n  o.x = 'no'\nend");
            StringAssert.Contains("(line 3)", error);
        }

        // ---- input

        [Test]
        public void InputShowsThePointerAndTheCallbacksFireOnTheRightFrames()
        {
            var r = Begin(@"
                log = ''
                function update(dt) if input.down then seenx = input.x seeny = input.y end end
                function on_tap(x, y) log = log .. 'T' end
                function on_hold(x, y) log = log .. 'H' end
                function on_drag(x, y, dx, dy) log = log .. 'D' dragged = dx end
                function on_release(x, y) log = log .. 'R' end");
            r.Step(Frame, new PointerState(0, 0, false));
            r.Step(Frame, new PointerState(1, 2, true));
            r.Step(Frame, new PointerState(1, 2, true));
            r.Step(Frame, new PointerState(2.5, 2, true));
            r.Step(Frame, new PointerState(2.5, 2, false));
            r.Step(Frame, new PointerState(2.5, 2, false));
            Assert.AreEqual("THHHDR", Text(r, "log"));
            Assert.AreEqual(1.5, Num(r, "dragged"), 1e-9);
            Assert.AreEqual(2.0, Num(r, "seeny"));
        }

        [Test]
        public void TapAndHoldFireTogetherOnThePressFrameAndDragNeedsMovement()
        {
            var r = Begin("log = '' function on_tap() log = log .. 'T' end function on_hold() log = log .. 'H' end function on_drag() log = log .. 'D' end");
            r.Step(Frame, new PointerState(0, 0, true));
            Assert.AreEqual("TH", Text(r, "log"));
            r.Step(Frame, new PointerState(0, 0, true));
            Assert.AreEqual("THH", Text(r, "log"), "held still: no drag");
            r.Step(Frame, new PointerState(0, 1, true));
            Assert.AreEqual("THHHD", Text(r, "log"));
        }

        // ---- ui

        [Test]
        public void UiTextAndBarAreKeptAndUpdatedInPlace()
        {
            var r = Begin(@"
                function init()
                  ui.text('score', 'Score: 0', { x = 0.5, y = 0.2, size = 0.06, color = 3, align = 'center' })
                  ui.bar('hp', 30, 100, { x = 0.1, y = 0.9, w = 0.5, h = 0.05, color = '#00ff00' })
                end
                function update(dt) ui.text('score', 'Score: ' .. math.floor(game.time * 100)) end");
            Play(r, 5);
            Assert.AreEqual(2, r.Api.Ui.Count);
            var text = r.Api.Ui[0];
            Assert.AreEqual("score", text.Id);
            StringAssert.StartsWith("Score: ", text.Text);
            Assert.AreEqual(0.5, text.X);
            Assert.AreEqual(0.2, text.Y);
            Assert.AreEqual(0.06, text.Size);
            Assert.AreEqual("3", text.Color);
            Assert.AreEqual("center", text.Align);
            var bar = r.Api.Ui[1];
            Assert.IsTrue(bar.IsBar);
            Assert.AreEqual(30.0, bar.Value);
            Assert.AreEqual(100.0, bar.Max);
            Assert.AreEqual(0.5, bar.W);
            Assert.AreEqual("#00ff00", bar.Color);
        }

        [Test]
        public void UiTextAcceptsANumberAndClearRemovesOneOrAll()
        {
            var r = Begin("function init() ui.text(1, 42) ui.text('b', 'x') ui.text('c', 'y') ui.clear('b') end");
            Assert.AreEqual(new[] { "1", "c" }, r.Api.Ui.Select(e => e.Id).ToArray());
            Assert.AreEqual("42", r.Api.Ui[0].Text);
            var all = Begin("function init() ui.text('a', 'x') ui.bar('b', 1, 2) ui.clear() end");
            Assert.AreEqual(0, all.Api.Ui.Count);
        }

        [Test]
        public void AtMostTwentyFourUiElementsAndTheRestAreDroppedAndCounted()
        {
            var r = Begin("function init() for i = 1, 30 do ui.text('t' .. i, 'x') end ui.text('t1', 'changed') end");
            Assert.AreEqual(GameApi.MaxUiElements, r.Api.Ui.Count);
            Assert.AreEqual(6, r.Api.DroppedUiElements);
            Assert.AreEqual("changed", r.Api.Ui[0].Text, "an existing element can still be updated");
        }

        [Test]
        public void UiRefusesLongTextAndBadArguments()
        {
            StringAssert.Contains("ui.text: text is too long (over 2000 characters)", FailureOf("function init() ui.text('a', string.rep('x', 2001)) end"));
            var edge = Begin("function init() ui.text('a', string.rep('x', 2000)) end");
            Assert.AreEqual(2000, edge.Api.Ui[0].Text.Length);
            StringAssert.Contains("ui.text: text must be a string or a number", FailureOf("function init() ui.text('a', {}) end"));
            StringAssert.Contains("ui.text: id must be a string or a number", FailureOf("function init() ui.text(nil, 'x') end"));
            StringAssert.Contains("ui.text: align must be", FailureOf("function init() ui.text('a', 'x', { align = 'middle' }) end"));
            StringAssert.Contains("ui.bar: value must be a number", FailureOf("function init() ui.bar('a', 'full', 10) end"));
            StringAssert.Contains("ui.text: the last argument must be a table", FailureOf("function init() ui.text('a', 'x', 5) end"));
        }

        // ---- timers

        [Test]
        public void TimerAfterFiresOnceAtItsTime()
        {
            var r = Begin("n = 0 function init() timer.after(0.5, function() n = n + 1 end) end");
            Play(r, 28);
            Assert.AreEqual(0.0, Num(r, "n"));
            Play(r, 6);
            Assert.AreEqual(1.0, Num(r, "n"));
            Play(r, 120);
            Assert.AreEqual(1.0, Num(r, "n"), "once");
        }

        [Test]
        public void TimerEveryRepeatsAndCancelStopsIt()
        {
            var r = Begin("n = 0 function init() id = timer.every(0.25, function() n = n + 1 end) end function on_tap() timer.cancel(id) end");
            Play(r, 61);
            Assert.AreEqual(4.0, Num(r, "n"), 1.0);
            var before = Num(r, "n");
            r.Step(Frame, new PointerState(0, 0, true));
            r.Step(Frame, new PointerState(0, 0, false));
            Play(r, 120);
            Assert.AreEqual(before, Num(r, "n"));
        }

        [Test]
        public void TimerReturnsDistinctIdsAndCancelOfANonsenseIdIsHarmless()
        {
            var r = Begin("function init() a = timer.after(1, function() end) b = timer.after(1, function() end) timer.cancel(999) end");
            Assert.AreNotEqual(Num(r, "a"), Num(r, "b"));
        }

        [Test]
        public void TimersFireInTheOrderOfTheirTimeAndMayStartMoreTimers()
        {
            var r = Begin(@"
                log = ''
                function init()
                  timer.after(0.3, function() log = log .. 'B' end)
                  timer.after(0.1, function() log = log .. 'A' timer.after(0, function() log = log .. 'C' end) end)
                end");
            Play(r, 40);
            Assert.AreEqual("ACB", Text(r, "log"));
        }

        [Test]
        public void AtMostFiftyTimersAndTheRestAreDroppedAndCounted()
        {
            var r = Begin("n = 0 function init() for i = 1, 60 do timer.after(0.1, function() n = n + 1 end) end end");
            Assert.AreEqual(10, r.Api.DroppedTimers);
            Play(r, 12);
            Assert.AreEqual(50.0, Num(r, "n"));
        }

        [Test]
        public void TimerChecksItsArguments()
        {
            StringAssert.Contains("timer.after: the second argument must be a function", FailureOf("function init() timer.after(1, 5) end"));
            StringAssert.Contains("timer.every: seconds must be a number", FailureOf("function init() timer.every('soon', function() end) end"));
            StringAssert.Contains("timer.after: seconds must not be negative", FailureOf("function init() timer.after(-1, function() end) end"));
        }

        [Test]
        public void ARepeatingTimerCannotFireMoreThanOncePerFrame()
        {
            var r = Begin("n = 0 function init() timer.every(0.0001, function() n = n + 1 end) end");
            Play(r, 60);
            Assert.AreEqual(60.0, Num(r, "n"), 2.0);
        }

        [Test]
        public void ATimerThatErrorsStopsTheGame()
        {
            StringAssert.Contains("boom", FailureOf("function init() timer.after(0, function() error('boom') end) end", 3));
        }

        // ---- random

        [Test]
        public void RandIsSeededAndRepeats()
        {
            const string script = "function init() a = rand() b = rand() c = rand_int(1, 6) end";
            var one = Begin(script, 7);
            var two = Begin(script, 7);
            var other = Begin(script, 8);
            Assert.AreEqual(Num(one, "a"), Num(two, "a"));
            Assert.AreEqual(Num(one, "b"), Num(two, "b"));
            Assert.AreEqual(Num(one, "c"), Num(two, "c"));
            Assert.AreNotEqual(Num(one, "a"), Num(other, "a"));
            Assert.AreNotEqual(Num(one, "a"), Num(one, "b"));
        }

        [Test]
        public void RandStaysInRangeAndRandIntIncludesBothEnds()
        {
            var r = Begin(@"
                lo, hi = 1, 0
                seen = {}
                function init()
                  for i = 1, 2000 do
                    local v = rand()
                    if v < lo then lo = v end
                    if v > hi then hi = v end
                    seen[rand_int(3, 5)] = true
                  end
                  swapped = rand_int(5, 3)
                end");
            Assert.GreaterOrEqual(Num(r, "lo"), 0.0);
            Assert.Less(Num(r, "hi"), 1.0);
            var seen = r.Host.Lua.Globals.Get("seen").Table;
            Assert.IsTrue(seen.Get(3).CastToBool() && seen.Get(4).CastToBool() && seen.Get(5).CastToBool());
            Assert.IsTrue(seen.Get(2).IsNil() && seen.Get(6).IsNil());
            Assert.That(Num(r, "swapped"), Is.InRange(3.0, 5.0));
        }

        [Test]
        public void RandIntChecksItsArguments()
        {
            StringAssert.Contains("rand_int: a must be a number", FailureOf("function init() rand_int('a', 2) end"));
        }

        [Test]
        public void MathRandomIsGoneSoRandIsTheOnlySource()
        {
            var r = Begin("function init() has = type(math.random) end");
            Assert.AreEqual("nil", Text(r, "has"));
        }

        // ---- the runner

        [Test]
        public void CallbacksRunInTheOrderUpdateInputCollisionsTimersExits()
        {
            var r = Begin(@"
                log = ''
                function init()
                  log = log .. 'i'
                  world.bounds(10, 10)
                  a = world.spawn('box', { solid = true })
                  b = world.spawn('box', { solid = true, x = 0.4 })
                  c = world.spawn('box', { x = 4.9, vx = 3 })
                  timer.after(0, function() log = log .. 't' end)
                end
                function update(dt) log = log .. 'u' end
                function on_tap() log = log .. 'p' end
                function on_collide(x, y) log = log .. 'c' end
                function on_exit(o) log = log .. 'x' end");
            r.Step(Frame, new PointerState(0, 0, true));
            Assert.AreEqual("iupct", Text(r, "log"), "init, update, tap, collide, timer; the exit comes a frame later");
            Play(r, 30, new PointerState(0, 0, true));
            StringAssert.Contains("x", Text(r, "log"));
            Assert.AreEqual(1, Text(r, "log").Count(ch => ch == 'x'));
            Assert.AreEqual(1, Text(r, "log").Count(ch => ch == 'c'));
        }

        [Test]
        public void InitRunsOnceAndUpdateGetsTheFrameTimeCappedAtOneTenth()
        {
            var r = Begin("inits = 0 function init() inits = inits + 1 end function update(dt) last = dt end");
            r.Step(0.016, default);
            Assert.AreEqual(0.016, Num(r, "last"), 1e-9);
            r.Step(5.0, default);
            Assert.AreEqual(ScriptRunner.MaxDt, Num(r, "last"), 1e-9);
            Assert.AreEqual(1.0, Num(r, "inits"));
        }

        [Test]
        public void StepStartsTheGameItselfWhenNeeded()
        {
            var runner = new ScriptRunner("function init() ready = true end");
            Assert.IsTrue(runner.Step(Frame, default));
            Assert.AreEqual("true", Text(runner, "ready"));
        }

        [Test]
        public void OnCollideGetsTheTwoObjectsAndSkipsOnesDestroyedEarlier()
        {
            var r = Begin(@"
                hits = 0
                function init()
                  a = world.spawn('box', { solid = true, tag = 'a' })
                  b = world.spawn('box', { solid = true, tag = 'b', x = 0.5 })
                  c = world.spawn('box', { solid = true, tag = 'c', x = 0.25 })
                end
                function on_collide(p, q)
                  hits = hits + 1
                  p:destroy()
                  q:destroy()
                  names = (names or '') .. p.tag .. q.tag
                end");
            Play(r, 2);
            Assert.AreEqual("ab", Text(r, "names"));
            Assert.AreEqual(1.0, Num(r, "hits"), "the pairs a-c and b-c were skipped: their objects were destroyed in the first callback");
        }

        [Test]
        public void OnExitGetsTheObjectAndMayDestroyIt()
        {
            var r = Begin(@"
                function init() world.bounds(10, 10) o = world.spawn('box', { vx = 6, tag = 'ball' }) end
                function on_exit(obj) left = obj.tag obj:destroy() end");
            Play(r, 120);
            Assert.AreEqual("ball", Text(r, "left"));
            Assert.AreEqual(0, r.World.Count());
        }

        [Test]
        public void PrintGoesToTheDeveloperLog()
        {
            var r = Begin("function init() print('hello', 5) end");
            Assert.AreEqual(1, r.Host.Log.Count);
            StringAssert.Contains("hello", r.Host.Log[0]);
        }

        [Test]
        public void ALuaErrorStopsTheGameWithItsMessageAndLine()
        {
            var runner = new ScriptRunner("function update(dt)\n  local t = nil\n  return t.x\nend");
            Assert.IsTrue(runner.Start());
            Assert.IsFalse(runner.Step(Frame, default));
            StringAssert.Contains("(line 3)", runner.Error);
            Assert.IsTrue(runner.Failed);
            Assert.IsFalse(runner.Step(Frame, default), "a failed game stays failed");
        }

        [Test]
        public void ASyntaxErrorOrATopLevelErrorStopsTheStart()
        {
            var bad = new ScriptRunner("function init(");
            Assert.IsFalse(bad.Start());
            Assert.IsNotNull(bad.Error);
            var top = new ScriptRunner("local x = nil\nx.y = 1");
            Assert.IsFalse(top.Start());
            StringAssert.Contains("(line 2)", top.Error);
        }

        [Test]
        public void AScriptOverItsBudgetInAFrameStopsTheGame()
        {
            var runner = new ScriptRunner("function update(dt) while true do end end");
            Assert.IsTrue(runner.Start());
            Assert.IsFalse(runner.Step(Frame, default));
            StringAssert.Contains("instruction budget", runner.Error);
        }

        [Test]
        public void ThreeSlowFramesInARowStopTheGame()
        {
            // a step reads the clock twice: every read is 300 ms after the one before, so each step looks like it took 300 ms
            var calls = 0;
            var runner = new ScriptRunner("function update(dt) end", 1, () => (calls++) * 0.3);
            Assert.IsTrue(runner.Start());
            Assert.IsTrue(runner.Step(Frame, default));
            Assert.IsTrue(runner.Step(Frame, default));
            Assert.IsFalse(runner.Step(Frame, default));
            StringAssert.Contains("too slowly", runner.Error);
        }

        [Test]
        public void ASlowFrameBetweenFastOnesDoesNotCount()
        {
            var calls = 0;
            // steps alternate: 300 ms, 10 ms, 300 ms, 10 ms ...
            var times = new[] { 0.0, 0.3, 0.3, 0.31, 0.31, 0.61, 0.61, 0.62, 0.62, 0.92, 0.92, 0.93 };
            var runner = new ScriptRunner("function update(dt) end", 1, () => times[Math.Min(calls++, times.Length - 1)]);
            Assert.IsTrue(runner.Start());
            for (var i = 0; i < 5; i++) Assert.IsTrue(runner.Step(Frame, default), runner.Error);
        }
    }
}
