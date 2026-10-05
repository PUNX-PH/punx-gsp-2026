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
    /// Real build.py output in the template: sample-built holds a biped (Run, Jump), a vehicle (Loop) and a gem (Loop), made from the
    /// default recipes in blender-worker/fixtures/recipes.
    /// </summary>
    public class BuiltModelTests
    {
        GameObject host;
        RunnerBootstrap bootstrap;

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
        }

        static string StreamingSettingsUrl(string folder) =>
            new Uri(Path.Combine(Application.streamingAssetsPath, folder, "settings.json")).AbsoluteUri;

        // As BootstrapTests.Boot: the wait is in real time, because with no graphics a frame takes microseconds.
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

        static Transform Joint(Transform root, string name)
        {
            foreach (var t in root.GetComponentsInChildren<Transform>(true))
                if (t.name == name) return t;
            Assert.Fail("no joint called " + name);
            return null;
        }

        static Animation AnimationOf(string wrapperName) => GameObject.Find(wrapperName).GetComponentInChildren<Animation>();

        [UnityTest]
        public IEnumerator Built_hero_keeps_its_clips_after_cloning()
        {
            yield return Boot("sample-built");
            yield return Wait(0.1f);

            var animation = AnimationOf("Hero");
            Assert.IsNotNull(animation, "the cloned hero has no Animation");
            Assert.IsNotNull(animation.GetClip("Run"));
            Assert.IsNotNull(animation.GetClip("Jump"));
            Assert.IsNotNull(bootstrap.View.HeroClips);
            Assert.AreEqual("Run", bootstrap.View.HeroClips.Playing);
        }

        [UnityTest]
        public IEnumerator Feet_swing_in_opposition_and_the_hand_swings_forward()
        {
            yield return Boot("sample-built");
            var hero = GameObject.Find("Hero").transform;
            var footL = Joint(hero, "foot_l");
            var footR = Joint(hero, "foot_r");
            var hand = Joint(hero, "hand_l");

            var left = new List<float>();
            var right = new List<float>();
            var handZ = new List<float>();
            var next = Time.realtimeSinceStartup;
            var end = next + 1f;
            while (Time.realtimeSinceStartup < end)
            {
                if (Time.realtimeSinceStartup >= next)
                {
                    left.Add(hero.InverseTransformPoint(footL.position).z);
                    right.Add(hero.InverseTransformPoint(footR.position).z);
                    handZ.Add(hero.InverseTransformPoint(hand.position).z);
                    next += 0.07f;
                }
                yield return null;
            }

            Assert.GreaterOrEqual(left.Count, 10, "too few samples to judge the swing");
            Assert.GreaterOrEqual(Range(left), 0.1f, "the left foot barely moves");
            Assert.GreaterOrEqual(Range(right), 0.1f, "the right foot barely moves");
            Assert.GreaterOrEqual(Range(handZ), 0.05f, "the hand barely swings");

            var meanL = Mean(left);
            var meanR = Mean(right);
            var together = 0f;
            for (var i = 0; i < left.Count; i++) together += (left[i] - meanL) * (right[i] - meanR);
            Assert.Less(together, 0f, "the feet move together instead of in opposition");
        }

        [UnityTest]
        public IEnumerator Jump_follows_the_air_progress_and_Run_returns_on_landing()
        {
            yield return Boot("sample-built");
            yield return Wait(0.2f);
            var clips = bootstrap.View.HeroClips;
            var animation = AnimationOf("Hero");

            bootstrap.Sim.Tick(0.001f, true);
            yield return Wait(0.2f);
            Assert.IsFalse(bootstrap.Sim.Grounded, "the jump already ended");
            Assert.AreEqual("Jump", clips.Playing);
            Assert.AreEqual(bootstrap.Sim.AirProgress, animation["Jump"].normalizedTime, 0.05f);

            var deadline = Time.realtimeSinceStartup + 3f;
            while (!bootstrap.Sim.Grounded && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.IsTrue(bootstrap.Sim.Grounded, "the hero never landed");
            yield return Wait(0.2f);
            Assert.AreEqual("Run", clips.Playing);
            Assert.Greater(animation["Run"].weight, 0.9f);
        }

        [UnityTest]
        public IEnumerator Pooled_collectibles_keep_playing_Loop()
        {
            yield return Boot("sample-built");
            yield return Wait(0.2f);
            var phases = AssertEveryActiveCollectiblePlaysLoop();
            // The importer already plays a model's only clip, so what proves LoopClips ran is that the clones do not move in lockstep.
            Assert.Greater(Range(phases), 0.01f, "every collectible is at the same point of its Loop");

            bootstrap.Sim.Restart();
            for (var i = 0; i < 10; i++) yield return null;
            AssertEveryActiveCollectiblePlaysLoop();
        }

        // Returns where in its clip each active collectible is (0 to 1).
        static List<float> AssertEveryActiveCollectiblePlaysLoop()
        {
            var phases = new List<float>();
            foreach (var wrapper in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                if (wrapper.name != "Collectible") continue;
                var animation = wrapper.GetComponentInChildren<Animation>();
                Assert.IsNotNull(animation, "a collectible has no Animation");
                Assert.IsTrue(animation.IsPlaying("Loop"), "an active collectible is not playing Loop");
                phases.Add(Mathf.Repeat(animation["Loop"].normalizedTime, 1f));
            }
            Assert.Greater(phases.Count, 1, "too few collectibles on screen to compare");
            return phases;
        }

        [UnityTest]
        public IEnumerator The_sample_without_clips_plays_still()
        {
            yield return Boot("sample");
            for (var i = 0; i < 60; i++) yield return null;
            Assert.IsNull(bootstrap.View.HeroClips);
            Assert.Greater(bootstrap.Sim.Z, 0f);
        }

        static float Range(List<float> values)
        {
            var low = float.MaxValue;
            var high = float.MinValue;
            foreach (var v in values)
            {
                low = Mathf.Min(low, v);
                high = Mathf.Max(high, v);
            }
            return high - low;
        }

        static float Mean(List<float> values)
        {
            var sum = 0f;
            foreach (var v in values) sum += v;
            return sum / values.Count;
        }
    }
}
