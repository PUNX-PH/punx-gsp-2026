using System;
using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    /// <summary>
    /// The world a made game gets from its environment (Build Environment): the sky, the ground's color and the scenery standing along both sides of the field.
    /// The scenery is the sample world's (a tree, a windmill and a rock built by build.py).
    /// </summary>
    public class MadeGameWorldTests
    {
        const string Palette = "\"palette\":[\"#1b1f3b\",\"#ff6b6b\",\"#ffd166\",\"#06d6a0\",\"#f1faee\"]";
        // sky is slot 1 (dark red), field slot 4 (green): easy to tell from the defaults
        const string Environment = "\"environment\":{\"sky\":1,\"field\":3,\"stripe\":4,\"density\":\"some\",\"scenery\":[\"scenery1.glb\",\"scenery2.glb\",\"scenery3.glb\"]}";

        GameObject host;
        RunnerBootstrap bootstrap;
        string folder;

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
            if (folder != null) try { Directory.Delete(folder, true); } catch (IOException) { }
        }

        IEnumerator Boot(string lua, string environment = Environment, bool withScenery = true)
        {
            folder = Path.Combine(Path.GetTempPath(), "runner-world-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "game.lua"), lua);
            File.WriteAllText(Path.Combine(folder, "settings.json"), "{" + Palette + ",\"script\":{\"file\":\"game.lua\",\"models\":[]}," + environment + "}");
            if (withScenery)
                foreach (var n in new[] { "scenery1.glb", "scenery2.glb", "scenery3.glb" })
                    File.Copy(Path.Combine(Application.streamingAssetsPath, "sample-world", n), Path.Combine(folder, n));
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = new Uri(Path.Combine(folder, "settings.json")).AbsoluteUri;
            bootstrap.ScriptSeed = 1;
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 20f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            for (var i = 0; i < 5; i++) yield return null;
        }

        static string Game(string mode) => "function init()\n  world.bounds(12, 24)\n  world.camera{ mode = \"" + mode + "\" }\n  world.spawn(\"box\", { x = 0, y = 0, w = 1, h = 1, d = 1, color = 3 })\nend\n";

        static Transform[] Scenery() =>
            Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Where(t => t.name == "Scenery").ToArray();

        [UnityTest]
        public IEnumerator A_ground_camera_shows_the_scenery_beyond_both_edges_of_the_field()
        {
            yield return Boot(Game("top"));
            var pieces = Scenery();
            Assert.Greater(pieces.Length, 6, "the scenery pool is missing");
            Assert.IsTrue(pieces.Any(p => p.position.x < -6f), "nothing stands left of the field");
            Assert.IsTrue(pieces.Any(p => p.position.x > 6f), "nothing stands right of the field");
            Assert.IsFalse(pieces.Any(p => Mathf.Abs(p.position.x) < 6f), "a piece of scenery stands on the field");
        }

        [UnityTest]
        public IEnumerator The_sky_and_the_ground_take_their_colors_from_the_environment()
        {
            yield return Boot(Game("top"));
            var sky = Camera.main.backgroundColor;
            Assert.Greater(sky.r, sky.g + 0.15f, "the sky is the environment's red (#ff6b6b) lifted toward daylight, not the default blue-grey sky");
            var ground = GameObject.Find("Ground").GetComponent<Renderer>();
            var block = new MaterialPropertyBlock();
            ground.GetPropertyBlock(block);
            var color = block.GetColor("_BaseColor");
            Assert.Greater(color.g, 0.6f, "the ground is the environment's green (#06d6a0), not the default slate");
            Assert.Less(color.r, 0.2f);
        }

        [UnityTest]
        public IEnumerator A_flat_camera_draws_no_scenery()
        {
            yield return Boot(Game("side2d"));
            Assert.AreEqual(0, Scenery().Length);
        }

        [UnityTest]
        public IEnumerator A_missing_scenery_file_leaves_that_piece_out_and_the_game_still_plays()
        {
            yield return Boot(Game("top"), Environment, withScenery: false);
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State);
            Assert.AreEqual(0, Scenery().Length);
        }

        [UnityTest]
        public IEnumerator A_game_with_no_environment_has_no_scenery_and_the_default_sky()
        {
            yield return Boot(Game("top"), "\"look\":\"lit\"", withScenery: false);
            Assert.AreEqual(0, Scenery().Length);
        }
    }
}
