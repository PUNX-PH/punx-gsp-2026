using System;
using System.Collections;
using System.IO;
using System.Linq;
using NUnit.Framework;
using Runner.Engine;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    /// <summary>
    /// What the platform attaches to every made game so it looks right without the person asking: the lit shader for models and primitives, a ground that is seen
    /// from above, objects resting on it, and a sky behind it (slice 9). Seen by eye on 2026-10-09 in a screenshot of the 3D lane runner with a freeform fox.
    /// </summary>
    public class MadeGameLookTests
    {
        GameObject host;
        RunnerBootstrap bootstrap;
        string folder;

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
            if (folder != null) try { Directory.Delete(folder, true); } catch (IOException) { }
        }

        // A chase-camera script with one box and one sphere left at z = 0 (a script that never sets z, as Claude's often do).
        const string Lua = @"
function init()
  world.camera{ mode = ""chase"" }
  world.spawn(""box"", { x = -1.6, y = 2, w = 1, h = 1, d = 1, color = 3 })
  world.spawn(""sphere"", { x = 1.6, y = 2, w = 1, h = 1, d = 1, color = 2 })
end
";

        IEnumerator Boot()
        {
            folder = Path.Combine(Path.GetTempPath(), "runner-look-tests", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, "game.lua"), Lua);
            File.WriteAllText(Path.Combine(folder, "settings.json"), "{\"palette\":[\"#1b1f3b\",\"#ff6b6b\",\"#ffd166\",\"#06d6a0\",\"#f1faee\"],\"script\":{\"file\":\"game.lua\",\"models\":[]}}");
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

        static Renderer[] Drawn() =>
            GameObject.Find("Script game").GetComponentsInChildren<Renderer>().Where(r => r.gameObject.activeInHierarchy).ToArray();

        [UnityTest]
        public IEnumerator A_made_game_draws_its_primitives_and_its_ground_with_the_lit_shader()
        {
            yield return Boot();
            var renderers = Drawn();
            Assert.GreaterOrEqual(renderers.Length, 3, "the ground, a box and a sphere");
            foreach (var r in renderers) Assert.AreEqual("Runner/Lit", r.sharedMaterial.shader.name, r.gameObject.name);
        }

        [UnityTest]
        public IEnumerator Objects_rest_on_the_ground_even_when_the_script_left_z_at_zero()
        {
            yield return Boot();
            var things = Drawn().Where(r => r.gameObject.name != "Ground").ToArray();
            Assert.GreaterOrEqual(things.Length, 2);
            foreach (var r in things) Assert.GreaterOrEqual(r.bounds.min.y, -0.001f, r.gameObject.name + " sinks into the ground");
        }

        [UnityTest]
        public IEnumerator Seen_from_behind_there_is_a_sky_not_the_dark_backdrop()
        {
            yield return Boot();
            var color = Camera.main.backgroundColor;
            Assert.Greater(color.b, 0.4f, "a chase camera looks over a horizon: the sky is light");
        }

        [Test]
        public void The_ground_plane_faces_up_so_a_lit_shader_does_not_cull_it_from_above()
        {
            var mesh = PrimitiveMeshes.Get("plane");
            var v = mesh.vertices;
            var t = mesh.triangles;
            Assert.Greater(t.Length, 0);
            // Unity draws the side a triangle's cross product points to (clockwise from the front)
            for (var i = 0; i < t.Length; i += 3)
            {
                var n = Vector3.Cross(v[t[i + 1]] - v[t[i]], v[t[i + 2]] - v[t[i]]);
                Assert.Greater(n.y, 0f, "the plane's triangle " + i / 3 + " faces down");
            }
        }
    }
}
