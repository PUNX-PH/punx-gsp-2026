using NUnit.Framework;
using Runner.Scripting;

namespace Runner.Tests
{
    /// <summary>The "script" key of a settings file: which Lua file to play, which models it may use, and the palette.</summary>
    public class ScriptSettingsTests
    {
        const string Palette = "\"palette\":[\"#112233\",\"#445566\",\"#778899\",\"#aabbcc\",\"#ddeeff\"]";

        [Test]
        public void SettingsWithoutAScriptKeyAreNotAScriptGame()
        {
            Assert.IsFalse(ScriptSettings.Read("{\"speed\":3}").Present);
            Assert.IsFalse(ScriptSettings.Read("{\"game\":{}}").Present);
            Assert.IsFalse(ScriptSettings.Read("not json").Present);
            Assert.IsFalse(ScriptSettings.Read("").Present);
        }

        [Test]
        public void AScriptKeyGivesTheFileTheModelsAndThePalette()
        {
            var read = ScriptSettings.Read("{" + Palette + ",\"script\":{\"file\":\"game.lua\",\"models\":[\"hero\",\"coin\"]}}");
            Assert.IsTrue(read.Present);
            Assert.IsNull(read.Error);
            Assert.AreEqual("game.lua", read.File);
            Assert.AreEqual(new[] { "hero", "coin" }, read.Models.ToArray());
            Assert.AreEqual("#112233", read.Palette[0]);
            Assert.AreEqual("#ddeeff", read.Palette[4]);
        }

        [Test]
        public void ModelsAreOptional()
        {
            var read = ScriptSettings.Read("{\"script\":{\"file\":\"game.lua\"}}");
            Assert.IsNull(read.Error);
            Assert.AreEqual(0, read.Models.Count);
        }

        [Test]
        public void ADefaultPaletteFillsInWhenTheSettingsHaveNone()
        {
            var read = ScriptSettings.Read("{\"script\":{\"file\":\"game.lua\"}}");
            Assert.AreEqual(5, read.Palette.Length);
            foreach (var color in read.Palette) StringAssert.IsMatch("^#[0-9a-f]{6}$", color);
        }

        [Test]
        public void ABadPaletteFallsBackToTheDefaultRatherThanStoppingTheGame()
        {
            var read = ScriptSettings.Read("{\"palette\":[\"red\"],\"script\":{\"file\":\"game.lua\"}}");
            Assert.IsNull(read.Error);
            Assert.AreEqual(5, read.Palette.Length);
        }

        [TestCase("{\"script\":5}", "object")]
        [TestCase("{\"script\":{}}", "file")]
        [TestCase("{\"script\":{\"file\":5}}", "file")]
        [TestCase("{\"script\":{\"file\":\"../game.lua\"}}", "file")]
        [TestCase("{\"script\":{\"file\":\"game.txt\"}}", "file")]
        [TestCase("{\"script\":{\"file\":\"a/b.lua\"}}", "file")]
        [TestCase("{\"script\":{\"file\":\"game.lua\",\"models\":\"hero\"}}", "models")]
        [TestCase("{\"script\":{\"file\":\"game.lua\",\"models\":[5]}}", "models")]
        [TestCase("{\"script\":{\"file\":\"game.lua\",\"models\":[\"Hero\"]}}", "models")]
        [TestCase("{\"script\":{\"file\":\"game.lua\",\"models\":[\"../x\"]}}", "models")]
        [TestCase("{\"script\":{\"file\":\"game.lua\",\"models\":[\"a\",\"b\",\"c\",\"d\",\"e\",\"f\",\"g\"]}}", "models")]
        public void BadScriptSettingsSayWhatIsWrong(string json, string word)
        {
            var read = ScriptSettings.Read(json);
            Assert.IsTrue(read.Present);
            Assert.IsNotNull(read.Error);
            StringAssert.Contains(word, read.Error);
        }

        [Test]
        public void AModelListedTwiceIsKeptOnce()
        {
            var read = ScriptSettings.Read("{\"script\":{\"file\":\"game.lua\",\"models\":[\"hero\",\"hero\"]}}");
            Assert.AreEqual(new[] { "hero" }, read.Models.ToArray());
        }
    }
}
