using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Text.RegularExpressions;
using NUnit.Framework;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    /// <summary>
    /// The High game: a lit look and a world. sample-world-high is real High output of build.py (a toy-robot hero, a vehicle, a gem, three scenery
    /// pieces, and the desert world's terrain, road and backdrop) with density "lots", the worst case for the renderer budget.
    /// </summary>
    public class LitWorldTests
    {
        const int RendererBudget = 100;
        static readonly string[] AllowedShaders = { "Runner/Lit", "Runner/Sky", "Runner/BlobShadow" };

        GameObject host;
        RunnerBootstrap bootstrap;
        readonly List<string> errors = new List<string>();

        [SetUp]
        public void SetUp()
        {
            errors.Clear();
            Application.logMessageReceived += OnLog;
        }

        [TearDown]
        public void TearDown()
        {
            Application.logMessageReceived -= OnLog;
            if (host != null) Object.DestroyImmediate(host);
        }

        // An error or an exception in the log fails the test: a CreatePrimitive in a build without physics would log one, and so would a missing shader.
        void OnLog(string condition, string stackTrace, LogType type)
        {
            if (type == LogType.Error || type == LogType.Exception || type == LogType.Assert) errors.Add(condition);
        }

        static string StreamingSettingsUrl(string folder) =>
            new Uri(Path.Combine(Application.streamingAssetsPath, folder, "settings.json")).AbsoluteUri;

        // As EnvironmentTests.Boot: the wait is in real time, because with no graphics a frame takes microseconds.
        IEnumerator Boot(string folder, bool expectReady = true)
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = StreamingSettingsUrl(folder);
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 30f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;
            if (expectReady) Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
        }

        static IEnumerator Wait(float seconds)
        {
            var end = Time.realtimeSinceStartup + seconds;
            while (Time.realtimeSinceStartup < end) yield return null;
        }

        static List<Transform> Named(string name)
        {
            var found = new List<Transform>();
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (t.name == name) found.Add(t);
            return found;
        }

        [UnityTest]
        public IEnumerator A_lit_game_with_a_world_loads_and_logs_how_long_it_took()
        {
            LogAssert.Expect(LogType.Log, new Regex("RUNNER ready in [0-9]+ ms"));
            yield return Boot("sample-world-high");
            yield return Wait(0.2f);

            Assert.IsNotNull(GameObject.Find("Sky"), "no sky");
            Assert.IsNotNull(GameObject.Find("Backdrop"), "no backdrop");
            Assert.IsNotNull(GameObject.Find("HeroShadow"), "no shadow under the hero");
            Assert.AreEqual(WorldPlacement.TileCount, Named("Terrain").Count, "terrain tiles");
            Assert.AreEqual(WorldPlacement.TileCount, Named("Road").Count, "road tiles");
            Assert.IsNull(GameObject.Find("Field"), "the plain field is not drawn in a world");
            Assert.IsNull(GameObject.Find("Stripes"), "the plain stripes are not drawn in a world");
            Assert.IsFalse(GameObject.Find("Ground") != null && GameObject.Find("Ground").activeSelf, "the plain ground is hidden in a world");
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [UnityTest]
        public IEnumerator Every_renderer_uses_the_lit_shader_except_the_sky_and_the_shadow()
        {
            LogAssert.Expect(LogType.Log, new Regex("RUNNER ready in [0-9]+ ms"));
            yield return Boot("sample-world-high");
            yield return Wait(0.3f);

            var checkedRenderers = 0;
            foreach (var renderer in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (renderer.name == "Ground") continue; // hidden in a world, so not found as active; named in case it is not
                foreach (var material in renderer.sharedMaterials)
                {
                    Assert.IsNotNull(material, renderer.name + " has an empty material slot");
                    Assert.Contains(material.shader.name, AllowedShaders, renderer.name + " is drawn with " + material.shader.name);
                }
                checkedRenderers++;
            }
            Assert.Greater(checkedRenderers, 10, "almost nothing was drawn");
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        [UnityTest]
        public IEnumerator The_active_renderer_count_stays_within_the_budget()
        {
            LogAssert.Expect(LogType.Log, new Regex("RUNNER ready in [0-9]+ ms"));
            yield return Boot("sample-world-high");
            yield return Wait(1.5f); // the hero runs, so obstacles and collectibles are on screen too

            var active = Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None).Length;
            Debug.Log("RUNNER active renderers: " + active + " (budget " + RendererBudget + ")");
            Assert.LessOrEqual(active, RendererBudget, "active renderers");
            Assert.IsEmpty(errors, string.Join("\n", errors));
        }

        // Instancing needs the clones to share one material: Instantiate copies the reference, and the generator turned instancing on.
        [UnityTest]
        public IEnumerator Pooled_clones_share_one_material_with_instancing_on()
        {
            LogAssert.Expect(LogType.Log, new Regex("RUNNER ready in [0-9]+ ms"));
            yield return Boot("sample-world-high");
            yield return Wait(0.2f);

            var obstacles = Named("Obstacle");
            Assert.GreaterOrEqual(obstacles.Count, 2, "the obstacle pool");
            var first = obstacles[0].GetComponentInChildren<Renderer>(true).sharedMaterial;
            var second = obstacles[1].GetComponentInChildren<Renderer>(true).sharedMaterial;
            Assert.AreSame(first, second, "two clones of one model have two materials");
            Assert.IsTrue(first.enableInstancing, "instancing is off");
            Assert.AreEqual("Runner/Lit", first.shader.name);

            var scenery = Named("Scenery");
            Assert.Greater(scenery.Count, 2, "the scenery pool");
            foreach (var wrapper in scenery)
                foreach (var renderer in wrapper.GetComponentsInChildren<Renderer>(true))
                    foreach (var material in renderer.sharedMaterials) Assert.IsTrue(material.enableInstancing, wrapper.name + " has a material without instancing");
        }

        [UnityTest]
        public IEnumerator The_terrain_and_the_road_tiles_follow_the_hero_by_whole_tiles()
        {
            LogAssert.Expect(LogType.Log, new Regex("RUNNER ready in [0-9]+ ms"));
            yield return Boot("sample-world-high");
            yield return Wait(2.0f);

            var heroZ = bootstrap.Sim.Z;
            var terrain = Named("Terrain");
            Assert.AreEqual(WorldPlacement.TileCount, terrain.Count);
            var lowest = float.MaxValue;
            var highest = float.MinValue;
            foreach (var tile in terrain)
            {
                var z = tile.position.z;
                Assert.AreEqual(0f, z % WorldPlacement.TilePeriod, 1e-3f, "a tile is off the pattern");
                lowest = Mathf.Min(lowest, z);
                highest = Mathf.Max(highest, z);
            }
            Assert.LessOrEqual(lowest, heroZ - WorldPlacement.Behind, "the ground starts too late");
            Assert.GreaterOrEqual(highest + WorldPlacement.TilePeriod, heroZ + WorldPlacement.Ahead, "the ground ends too soon");
        }

        [UnityTest]
        public IEnumerator A_missing_world_file_stops_the_game_and_names_the_file()
        {
            LogAssert.Expect(LogType.Error, new Regex("Runner: world \\(terrain\\.glb\\)")); // the bootstrap logs why it stopped
            yield return Boot("sample-world-missing", expectReady: false);

            Assert.AreEqual(RunnerBootstrap.BootState.Failed, bootstrap.State);
            StringAssert.Contains("world (terrain.glb)", bootstrap.Error);
        }
    }
}
