using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Runner.Scripting;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    /// <summary>A script game booted from a settings file: each example game starts and draws, ends when driven, an error shows its message, models load.</summary>
    public class ScriptPlayTests
    {
        const string Palette = "\"palette\":[\"#1b1f3b\",\"#ff6b6b\",\"#ffd166\",\"#06d6a0\",\"#f1faee\"]";

        GameObject host;
        RunnerBootstrap bootstrap;
        readonly List<string> folders = new List<string>();

        [TearDown]
        public void TearDown()
        {
            LogAssert.ignoreFailingMessages = false;
            if (host != null) Object.DestroyImmediate(host);
            foreach (var folder in folders)
            {
                try { Directory.Delete(folder, true); } catch (IOException) { }
            }
        }

        string MakeGame(string lua, string models = "[]", bool withHero = false)
        {
            var dir = Path.Combine(Path.GetTempPath(), "runner-script-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(dir);
            folders.Add(dir);
            File.WriteAllText(Path.Combine(dir, "game.lua"), lua);
            File.WriteAllText(Path.Combine(dir, "settings.json"), "{" + Palette + ",\"script\":{\"file\":\"game.lua\",\"models\":" + models + "}}");
            if (withHero) File.Copy(Path.Combine(Application.streamingAssetsPath, "sample", "hero.glb"), Path.Combine(dir, "entity-hero.glb"));
            return new Uri(Path.Combine(dir, "settings.json")).AbsoluteUri;
        }

        static string Example(string name) => File.ReadAllText(Path.Combine(Application.dataPath, "Runner", "Tests", "Scripts", name + ".lua"));

        // The wait is in real time: with no graphics a frame takes microseconds.
        IEnumerator Boot(string settingsUrl)
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = settingsUrl;
            bootstrap.ScriptSeed = 1;
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 20f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;
        }

        static int DrawnObjects()
        {
            var root = GameObject.Find("Script game");
            if (root == null) return 0;
            return root.GetComponentsInChildren<Renderer>().Count(r => r.gameObject.activeInHierarchy && r.gameObject.name != "Ground" && r.gameObject.name != "Shadow");
        }

        [UnityTest]
        public IEnumerator Each_example_game_boots_to_ready_and_draws_its_objects([ValueSource(nameof(Examples))] string name)
        {
            yield return Boot(MakeGame(Example(name)));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            Assert.IsNotNull(bootstrap.Script);
            for (var i = 0; i < 20; i++) yield return null;
            Assert.IsFalse(bootstrap.Script.Failed, bootstrap.Script.Error);
            Assert.Greater(DrawnObjects(), 0, name + " drew nothing");
        }

        static string[] Examples() => new[] { "runner", "flier", "catcher", "crosser", "collector", "glider" };

        [UnityTest]
        public IEnumerator A_game_ends_in_a_loss_when_driven_and_a_press_starts_a_new_round()
        {
            yield return Boot(MakeGame(Example("flier")));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            var view = bootstrap.Script;
            for (var i = 0; i < 120 && !view.Over; i++) view.Tick(1f / 60f, Vector2.zero, false);
            Assert.IsTrue(view.Over, "the bird should have fallen off the screen");
            Assert.AreEqual(GameOutcome.Lost, view.Runner.Api.Outcome);
            StringAssert.Contains("Game over", view.EndText);
            StringAssert.Contains("You hit the edge", view.EndText);

            view.Tick(1f / 60f, Vector2.zero, false);
            view.Tick(1f / 60f, Vector2.zero, true); // a press
            Assert.IsFalse(view.Over, "a press on the end screen starts a new round");
            Assert.AreEqual(0, view.Score);
        }

        [UnityTest]
        public IEnumerator A_script_with_an_error_shows_its_message_and_the_scene_survives()
        {
            LogAssert.ignoreFailingMessages = true;
            yield return Boot(MakeGame("function init() world.spawn('box') end\nfunction update(dt)\n  local t = nil\n  return t.x\nend"));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            for (var i = 0; i < 10; i++) yield return null;
            Assert.IsTrue(bootstrap.Script.Failed);
            StringAssert.Contains("(line 4)", bootstrap.Script.Error);
            var hud = host.GetComponent<Hud>();
            StringAssert.StartsWith("The game stopped:", hud.ErrorMessage);
            StringAssert.Contains("(line 4)", hud.ErrorMessage);
            Assert.IsNotNull(GameObject.Find("Script game"), "the scene is still there");
            Assert.Greater(DrawnObjects(), 0);
            for (var i = 0; i < 5; i++) yield return null; // and it keeps running without throwing
        }

        [UnityTest]
        public IEnumerator A_script_that_does_not_compile_stops_the_game_at_the_start_with_its_message()
        {
            LogAssert.ignoreFailingMessages = true;
            yield return Boot(MakeGame("function init("));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            for (var i = 0; i < 3; i++) yield return null;
            Assert.IsTrue(bootstrap.Script.Failed);
            StringAssert.StartsWith("The game stopped:", host.GetComponent<Hud>().ErrorMessage);
        }

        [UnityTest]
        public IEnumerator A_model_loads_and_a_missing_one_is_drawn_as_a_box()
        {
            LogAssert.ignoreFailingMessages = true;
            yield return Boot(MakeGame("function init() world.spawn('hero', { x = -1 }) world.spawn('ghost', { x = 1 }) end", "[\"hero\",\"ghost\"]", true));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            for (var i = 0; i < 5; i++) yield return null;
            Assert.IsFalse(bootstrap.Script.Failed, bootstrap.Script.Error);
            var hero = GameObject.Find("hero");
            Assert.IsNotNull(hero);
            Assert.Greater(hero.GetComponentsInChildren<Renderer>().Length, 0, "the model's own renderers");
            Assert.IsNull(hero.GetComponent<MeshFilter>(), "a model sits inside a holder");
            var ghost = GameObject.Find("ghost");
            Assert.IsNotNull(ghost);
            Assert.IsNotNull(ghost.GetComponent<MeshFilter>(), "the missing model is a primitive");
        }

        [UnityTest]
        public IEnumerator The_pointer_is_mapped_into_the_field()
        {
            yield return Boot(MakeGame("function on_tap(x, y) tx = x ty = y end"));
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            var view = bootstrap.Script;
            float W() => Screen.width;
            float H() => Screen.height;

            view.Tick(1f / 60f, new Vector2(W() / 2f, H() / 2f), false);
            view.Tick(1f / 60f, new Vector2(W() / 2f, H() / 2f), true);
            var lua = view.Runner.Host.Lua.Globals;
            Assert.AreEqual(0.0, lua.Get("tx").Number, 0.3);
            Assert.AreEqual(0.0, lua.Get("ty").Number, 0.3);

            view.Tick(1f / 60f, new Vector2(W() * 0.5f, H() * 0.5f), false);
            view.Tick(1f / 60f, new Vector2(W() * 0.9f, H() * 0.8f), true);
            Assert.Greater(lua.Get("tx").Number, 1.0, "right of the middle is positive x");
            Assert.Greater(lua.Get("ty").Number, 1.0, "above the middle is positive y");
        }

        [UnityTest]
        public IEnumerator Every_camera_mode_boots_and_draws()
        {
            foreach (var mode in new[] { "side", "top", "chase", "fixed", "side2d", "top2d" })
            {
                if (host != null) Object.DestroyImmediate(host);
                yield return Boot(MakeGame("function init() world.camera{ mode = '" + mode + "' } local o = world.spawn('box', { x = 1, y = 2, z = 0.5 }) world.spawn('quad', { x = -1 }) world.spawn('cone', { y = -2 }) world.spawn('plane') end"));
                Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, mode + ": " + bootstrap.Error);
                for (var i = 0; i < 3; i++) yield return null;
                Assert.IsFalse(bootstrap.Script.Failed, mode + ": " + bootstrap.Script.Error);
                Assert.AreEqual(4, DrawnObjects(), mode);
            }
        }
    }
}
