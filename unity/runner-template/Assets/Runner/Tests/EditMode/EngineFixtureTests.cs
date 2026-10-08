using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Runner.Engine;
using UnityEngine;

namespace Runner.Tests
{
    /// <summary>
    /// The engine against the fixtures the TypeScript simulator recorded (Tests/Engine, copied from web/src/lib/engine/fixtures): every spec parses, every
    /// checkpoint digest is equal, and every bad spec is refused with the website's sentence. unity/tools/engine-check.sh runs the same comparison with no Unity.
    /// </summary>
    public class EngineFixtureTests
    {
        static string Path_(string relative) => System.IO.Path.Combine(Application.dataPath, "Runner/Tests/Engine", relative);

        // Every spec in Tests/Engine/specs: the three games, the two vocabulary sweeps and the micro cases.
        static IEnumerable<string> Names()
        {
            var names = new List<string>();
            foreach (var file in Directory.GetFiles(Path_("specs"), "*.json")) names.Add(System.IO.Path.GetFileNameWithoutExtension(file));
            names.Sort(System.StringComparer.Ordinal);
            return names;
        }

        [TestCaseSource(nameof(Names))]
        public void ReplaysToTheRecordedDigests(string name)
        {
            Assert.IsTrue(SpecParser.TryParse(File.ReadAllText(Path_("specs/" + name + ".json")), out var spec, out var error), error);
            Assert.IsTrue(InputLog.TryParse(File.ReadAllText(Path_("logs/" + name + ".json")), out var log));
            MiniJson.TryParse(File.ReadAllText(Path_("expected.json")), out var root, out _);
            var want = (List<object>)((JsonObject)root).Get(name);
            var states = Digest.Replay(spec, log);
            Assert.AreEqual(want.Count, states.Count);
            for (var i = 0; i < states.Count; i++)
            {
                var w = (JsonObject)want[i];
                Assert.AreEqual((long)(double)w.Get("step"), states[i].Step, name + " checkpoint " + i);
                Assert.AreEqual((string)w.Get("digest"), Digest.Of(states[i]), name + " checkpoint " + i);
            }
        }

        [Test]
        public void RefusesEveryBadSpecWithTheWebsitesSentence()
        {
            MiniJson.TryParse(File.ReadAllText(Path_("bad-specs.json")), out var root, out _);
            foreach (var c in (List<object>)root)
            {
                var co = (JsonObject)c;
                var name = (string)co.Get("name");
                Assert.IsFalse(SpecParser.TryParse((string)co.Get("text"), out _, out var error), name + " should be refused");
                Assert.AreEqual((string)co.Get("error"), error, name);
            }
        }

        [Test]
        public void RefusesTextThatIsNotJson()
        {
            Assert.IsFalse(SpecParser.TryParse("{not json", out _, out var error));
            StringAssert.StartsWith("game: not valid JSON", error);
        }
    }
}
