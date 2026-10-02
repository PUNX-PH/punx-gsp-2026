using System;
using System.Collections;
using System.IO;
using NUnit.Framework;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    public class BootstrapTests
    {
        GameObject host;
        RunnerBootstrap bootstrap;

        [TearDown]
        public void TearDown()
        {
            LogAssert.ignoreFailingMessages = false;
            if (host != null) Object.DestroyImmediate(host);
        }

        static string StreamingSettingsUrl(string folder) =>
            new Uri(Path.Combine(Application.streamingAssetsPath, folder, "settings.json")).AbsoluteUri;

        // Starts a bootstrap with the given settings URL and waits until it stops loading. The wait is in real
        // time: with no graphics a frame takes microseconds, so a frame count would end before a request does.
        IEnumerator Boot(string settingsUrl)
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false); // keep Start from running until the override is set
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = settingsUrl;
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 20f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;
        }

        [UnityTest]
        public IEnumerator Sample_loads_and_runs()
        {
            yield return Boot(StreamingSettingsUrl("sample"));

            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            Assert.IsNotNull(GameObject.Find("Hero"));
            for (var i = 0; i < 60; i++) yield return null;
            Assert.Greater(bootstrap.Sim.Z, 0f);
        }

        // Models must render through the one flat shader (no PBR shader graphs, which broke WebGL builds),
        // tinted with the colour their glTF material declares: hero.glb is #3a86ff.
        [UnityTest]
        public IEnumerator Models_use_the_flat_shader_tinted_with_their_own_colour()
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = StreamingSettingsUrl("sample");
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 20f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;

            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
            var material = GameObject.Find("Hero").GetComponentInChildren<Renderer>().sharedMaterial;
            Assert.AreEqual("Runner/Flat", material.shader.name);
            var expected = new Color(0x3a / 255f, 0x86 / 255f, 0xff / 255f);
            var actual = material.GetColor("_BaseColor");
            Assert.AreEqual(expected.r, actual.r, 0.02f);
            Assert.AreEqual(expected.g, actual.g, 0.02f);
            Assert.AreEqual(expected.b, actual.b, 0.02f);
        }

        [UnityTest]
        public IEnumerator Missing_settings_url_fails_visibly()
        {
            LogAssert.ignoreFailingMessages = true;
            yield return Boot("missing/settings.json");

            Assert.AreEqual(RunnerBootstrap.BootState.Failed, bootstrap.State);
            StringAssert.Contains("settings", bootstrap.Error);
        }

        [UnityTest]
        public IEnumerator Corrupt_role_file_fails_naming_the_role()
        {
            LogAssert.ignoreFailingMessages = true;
            yield return Boot(StreamingSettingsUrl("sample-broken"));

            Assert.AreEqual(RunnerBootstrap.BootState.Failed, bootstrap.State);
            StringAssert.Contains("hero", bootstrap.Error);
            Assert.IsNull(GameObject.Find("Hero"));
        }
    }
}
