using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using NUnit.Framework;
using Runner.View;
using UnityEngine;
using UnityEngine.TestTools;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    /// <summary>
    /// The world around the track: sample-world holds the hero, obstacle and coin of sample-built and three scenery pieces (a tree, a
    /// windmill and a rock) built by build.py, with density "lots" (the worst case for the renderer budget).
    /// </summary>
    public class EnvironmentTests
    {
        GameObject host;
        GameObject loose;
        RunnerBootstrap bootstrap;

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
            if (loose != null) Object.DestroyImmediate(loose);
        }

        static string StreamingSettingsUrl(string folder) =>
            new Uri(Path.Combine(Application.streamingAssetsPath, folder, "settings.json")).AbsoluteUri;

        // As BuiltModelTests.Boot: the wait is in real time, because with no graphics a frame takes microseconds.
        IEnumerator Boot(string folder)
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = StreamingSettingsUrl(folder);
            host.SetActive(true);
            var deadline = Time.realtimeSinceStartup + 20f;
            while (bootstrap.State == RunnerBootstrap.BootState.Loading && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.AreEqual(RunnerBootstrap.BootState.Ready, bootstrap.State, bootstrap.Error);
        }

        static IEnumerator Wait(float seconds)
        {
            var end = Time.realtimeSinceStartup + seconds;
            while (Time.realtimeSinceStartup < end) yield return null;
        }

        static List<Transform> SceneryWrappers()
        {
            var found = new List<Transform>();
            foreach (var t in Object.FindObjectsByType<Transform>(FindObjectsInactive.Include, FindObjectsSortMode.None))
                if (t.name == "Scenery") found.Add(t);
            return found;
        }

        static bool HasJoint(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name) return true;
            return false;
        }

        [UnityTest]
        public IEnumerator World_loads_with_field_stripes_and_scenery()
        {
            yield return Boot("sample-world");
            yield return Wait(0.2f);

            Assert.IsNotNull(GameObject.Find("Field"), "no field");
            var stripes = GameObject.Find("Stripes");
            Assert.IsNotNull(stripes, "no stripes");
            Assert.AreEqual(1, stripes.GetComponentsInChildren<Renderer>().Length, "the stripes should be one renderer");

            var expected = 2 * SceneryLayout.PoolSize(SceneryLayout.Spacing("lots"), 3);
            Assert.AreEqual(expected, SceneryWrappers().Count, "scenery wrappers");

            ColorUtility.TryParseHtmlString("#1b1f3b", out var slotZero); // sky is palette slot 0 in sample-world
            var background = GameObject.Find("Camera").GetComponent<Camera>().backgroundColor;
            Assert.AreEqual(slotZero.r, background.r, 1e-3f);
            Assert.AreEqual(slotZero.g, background.g, 1e-3f);
            Assert.AreEqual(slotZero.b, background.b, 1e-3f);
        }

        [UnityTest]
        public IEnumerator Scenery_recycles_without_changing_model_or_moving_in_view()
        {
            yield return null;
            var flatShader = Shader.Find("Runner/Flat");
            Assert.IsNotNull(flatShader, "the Runner/Flat shader is missing");
            var flat = new Material(flatShader);

            loose = new GameObject("LooseWorld");
            var names = new[] { "A", "B", "C" };
            var prototypes = new List<GameObject>();
            foreach (var name in names)
            {
                var prototype = GameObject.CreatePrimitive(PrimitiveType.Cube);
                prototype.name = name;
                prototype.transform.SetParent(loose.transform, false);
                prototype.SetActive(false); // hidden, as the bootstrap hands them over
                prototypes.Add(prototype);
            }

            const float spacing = 12f;
            var view = new EnvironmentView(loose.transform, prototypes, Color.green, Color.white, flat, spacing);
            var wrappers = view.Scenery;
            var poolSize = SceneryLayout.PoolSize(spacing, names.Length);
            Assert.AreEqual(2 * poolSize, wrappers.Count);

            // Which model each wrapper holds when it is made: it must never change.
            var modelOf = new string[wrappers.Count];
            for (var i = 0; i < wrappers.Count; i++) modelOf[i] = wrappers[i].GetChild(0).name;

            var previous = new Vector3[wrappers.Count];
            var previousHeroZ = 0f;
            view.Sync(0f);
            for (var i = 0; i < wrappers.Count; i++) previous[i] = wrappers[i].localPosition;

            for (var heroZ = 0.37f; heroZ <= 600f; heroZ += 0.37f)
            {
                view.Sync(heroZ);

                for (var i = 0; i < wrappers.Count; i++)
                {
                    Assert.AreEqual(modelOf[i], wrappers[i].GetChild(0).name, "wrapper " + i + " changed model at z " + heroZ);

                    // One that stood well inside the view on the step before has not moved.
                    var wasInView = previous[i].z >= previousHeroZ - SceneryLayout.Behind + 0.5f && previous[i].z <= previousHeroZ + SceneryLayout.Ahead - 0.5f;
                    if (wasInView)
                        Assert.AreEqual(previous[i], wrappers[i].localPosition, "wrapper " + i + " moved while in view, at z " + heroZ);
                    previous[i] = wrappers[i].localPosition;
                }
                previousHeroZ = heroZ;

                // Every slot in the view has a wrapper, of the model the layout gives for that slot.
                for (var side = 0; side < 2; side++)
                {
                    var first = SceneryLayout.FirstSlot(heroZ, spacing);
                    for (var slot = first; SceneryLayout.SlotZ(slot, spacing) <= heroZ + SceneryLayout.Ahead - 0.5f; slot++)
                    {
                        var z = SceneryLayout.SlotZ(slot, spacing);
                        if (z < heroZ - SceneryLayout.Behind + 0.5f) continue;
                        var wanted = names[SceneryLayout.ModelForSlot(slot, side, names.Length)] + "(Clone)";
                        var found = false;
                        for (var i = 0; i < wrappers.Count && !found; i++)
                        {
                            var p = wrappers[i].localPosition;
                            found = Mathf.Approximately(p.z, z) && Mathf.Approximately(p.x, SceneryLayout.SideX(slot, side)) && modelOf[i] == wanted;
                        }
                        Assert.IsTrue(found, "no " + wanted + " at slot " + slot + " on side " + side + " with the hero at z " + heroZ);
                    }
                }
            }
        }

        [UnityTest]
        public IEnumerator Scenery_keeps_its_Loop_playing()
        {
            yield return Boot("sample-world");
            yield return Wait(0.3f);

            var windmills = 0;
            var trees = 0;
            foreach (var wrapper in SceneryWrappers())
            {
                var animation = wrapper.GetComponentInChildren<Animation>();
                if (HasJoint(wrapper, "blades")) windmills++;
                else if (HasJoint(wrapper, "canopy")) trees++;
                else continue; // the rock stands still
                Assert.IsNotNull(animation, "an animated piece of scenery has no Animation");
                Assert.IsTrue(animation.IsPlaying("Loop"), "a " + (HasJoint(wrapper, "blades") ? "windmill" : "tree") + " is not playing Loop");
            }
            Assert.Greater(windmills, 0, "no windmill in the pool");
            Assert.Greater(trees, 0, "no tree in the pool");
        }

        [UnityTest]
        public IEnumerator Renderer_count_stays_within_budget()
        {
            yield return Boot("sample-world");
            yield return Wait(1f);

            var active = 0;
            foreach (var renderer in Object.FindObjectsByType<Renderer>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
                if (renderer.enabled && renderer.gameObject.activeInHierarchy) active++;
            Debug.Log("Renderer count after 1 s of sample-world: " + active);
            Assert.LessOrEqual(active, 120, "too many active renderers: " + active);
        }
    }
}
