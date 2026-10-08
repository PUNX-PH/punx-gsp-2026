using System.Diagnostics;
using NUnit.Framework;
using Runner.Scripting;

namespace Runner.Tests
{
    /// <summary>What a generated script can and cannot do: nothing outside its sandbox, and nothing that outlasts its budget.</summary>
    public class ScriptSandboxTests
    {
        static ScriptHost Loaded(string source)
        {
            var host = new ScriptHost();
            Assert.IsTrue(host.Load(source, out var error), error);
            return host;
        }

        [TestCase("os")]
        [TestCase("io")]
        [TestCase("debug")]
        [TestCase("require")]
        [TestCase("load")]
        [TestCase("loadstring")]
        [TestCase("loadfile")]
        [TestCase("dofile")]
        [TestCase("collectgarbage")]
        [TestCase("coroutine")]
        [TestCase("setmetatable")]
        [TestCase("getmetatable")]
        [TestCase("luanet")]
        [TestCase("clr")]
        [TestCase("UnityEngine")]
        [TestCase("System")]
        public void ARemovedNameIsNil(string name)
        {
            var host = Loaded("kind = type(" + name + ")");
            Assert.AreEqual("nil", host.GetGlobalString("kind"));
        }

        [Test]
        public void MathRandomIsGoneButTheRestOfMathStays()
        {
            var host = Loaded("a = type(math.random); b = type(math.randomseed); c = math.floor(2.7) + math.max(1, 3)");
            Assert.AreEqual("nil", host.GetGlobalString("a"));
            Assert.AreEqual("nil", host.GetGlobalString("b"));
            Assert.AreEqual("5", host.GetGlobalString("c"));
        }

        [Test]
        public void TheAllowedLibrariesWork()
        {
            var host = Loaded("s = string.upper('ab') .. #table.concat({1,2,3}, ','); t = {}; table.insert(t, 7); n = t[1]");
            Assert.AreEqual("AB5", host.GetGlobalString("s"));
            Assert.AreEqual("7", host.GetGlobalString("n"));
        }

        [Test]
        public void PrintGoesToTheLogAndIsCapped()
        {
            var host = Loaded("for i = 1, 500 do print('line ' .. i) end print(string.rep('x', 150))");
            Assert.AreEqual(200, host.Log.Count);
            Assert.AreEqual("line 1", host.Log[0]);
        }

        [Test]
        public void ANeverEndingLoopStopsAtTheBudgetQuickly()
        {
            var host = Loaded("function update() while true do end end");
            var watch = Stopwatch.StartNew();
            Assert.IsFalse(host.Call("update", out var error));
            watch.Stop();
            StringAssert.Contains("over its instruction budget", error);
            Assert.Less(watch.ElapsedMilliseconds, 500);
        }

        [Test]
        public void ALoopAtTheTopLevelStopsToo()
        {
            var host = new ScriptHost();
            Assert.IsFalse(host.Load("while true do end", out var error));
            StringAssert.Contains("over its instruction budget", error);
        }

        [Test]
        public void AGoodCallStaysInsideTheBudgetAndCountsItsInstructions()
        {
            var host = Loaded("function update(dt) local s = 0 for i = 1, 1000 do s = s + i end total = s end");
            Assert.IsTrue(host.Call("update", out var error, 0.016), error);
            Assert.AreEqual("500500", host.GetGlobalString("total"));
            Assert.Greater(host.InstructionsLastCall, 0);
            Assert.Less(host.InstructionsLastCall, 200000);
        }

        [Test]
        public void AnErrorStopsTheCallWithItsMessageAndLine()
        {
            var host = Loaded("function update()\n  local x = nil\n  return x.y\nend");
            Assert.IsFalse(host.Call("update", out var error));
            StringAssert.Contains("(line 3)", error);
            StringAssert.Contains("index", error);
        }

        [Test]
        public void ASyntaxErrorIsReportedWithItsLine()
        {
            var host = new ScriptHost();
            Assert.IsFalse(host.Load("x = 1\nfunction (", out var error));
            StringAssert.Contains("line 2", error);
        }

        static void AssertTooLong(string body, string expected = "string too long")
        {
            var host = new ScriptHost();
            Assert.IsTrue(host.Load("function update() " + body + " end", out var loadError), loadError);
            Assert.IsFalse(host.Call("update", out var error));
            StringAssert.Contains(expected, error);
        }

        [Test]
        public void StringRepOfAHugeSizeIsRefused() => AssertTooLong("s = string.rep('x', 1000000000)");

        [Test]
        public void DoublingAStringIsRefused() => AssertTooLong("local s = 'xxxxxxxx' for i = 1, 40 do s = s .. s end");

        [Test]
        public void AHugeFormatWidthIsRefused() => AssertTooLong("s = string.format('%999999999d', 1)", "string too long (a format width");

        [Test]
        public void ACallToAFunctionTheScriptDoesNotDefineIsNotAnError()
        {
            var host = Loaded("function update() end");
            Assert.IsTrue(host.Call("on_tap", out var error, 1.0, 2.0), error);
            Assert.IsFalse(host.Has("on_tap"));
            Assert.IsTrue(host.Has("update"));
        }

        [Test]
        public void ArgumentsReachTheFunction()
        {
            var host = Loaded("function on_tap(x, y) got = x * 10 + y end");
            Assert.IsTrue(host.Call("on_tap", out var error, 3.0, 4.0), error);
            Assert.AreEqual("34", host.GetGlobalString("got"));
        }

        [Test]
        public void TheGlobalStateSurvivesBetweenCalls()
        {
            var host = Loaded("count = 0 function update() count = count + 1 end");
            for (var i = 0; i < 5; i++) Assert.IsTrue(host.Call("update", out var error), error);
            Assert.AreEqual("5", host.GetGlobalString("count"));
        }
    }
}
