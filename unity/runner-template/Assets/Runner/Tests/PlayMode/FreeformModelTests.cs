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
    /// Real freeform models (blender-worker/scripts/build.py, slice 9) in the player: sample-freeform holds a rigged quadruped fox as the hero
    /// (Run and Jump that swing its four legs, head and tail), a crate (no clips) and a spaceship that turns (Loop). It checks what only Unity can:
    /// that the imported joints are there, that the clips play on them, and that the legs really swing in a trot.
    /// </summary>
    public class FreeformModelTests
    {
        GameObject host;
        RunnerBootstrap bootstrap;

        [TearDown]
        public void TearDown()
        {
            if (host != null) Object.DestroyImmediate(host);
        }

        // As BuiltModelTests.Boot: the wait is in real time, because with no graphics a frame takes microseconds.
        IEnumerator Boot()
        {
            host = new GameObject("BootstrapHost");
            host.SetActive(false);
            bootstrap = host.AddComponent<RunnerBootstrap>();
            bootstrap.SettingsUrlOverride = new Uri(Path.Combine(Application.streamingAssetsPath, "sample-freeform", "settings.json")).AbsoluteUri;
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

        // Where the leg's mesh is, in the hero's own space: the mesh hangs from its joint, so it moves when the joint turns.
        static Vector3 Where(Transform hero, string joint) =>
            hero.InverseTransformPoint(Joint(hero, joint + "_mesh").GetComponentInChildren<Renderer>().bounds.center);

        // Samples a joint's mesh for a second, as the clips run (real time, about every 70 ms).
        static IEnumerator Sample(Transform hero, string joint, List<float> z, List<float> y)
        {
            var next = Time.realtimeSinceStartup;
            var end = next + 1f;
            while (Time.realtimeSinceStartup < end)
            {
                if (Time.realtimeSinceStartup >= next)
                {
                    var p = Where(hero, joint);
                    z.Add(p.z);
                    y.Add(p.y);
                    next += 0.07f;
                }
                yield return null;
            }
        }

        [UnityTest]
        public IEnumerator The_rigged_hero_is_imported_with_a_node_for_each_joint_and_Run_and_Jump_clips()
        {
            yield return Boot();
            yield return Wait(0.1f);
            var hero = GameObject.Find("Hero").transform;
            foreach (var name in new[] { "model", "head", "tail", "leg_front_l", "leg_front_r", "leg_back_l", "leg_back_r" }) Joint(hero, name);
            Assert.GreaterOrEqual(hero.GetComponentsInChildren<Renderer>(true).Length, 6, "the body, the head, the tail and four legs are meshes of their own");

            var animation = hero.GetComponentInChildren<Animation>();
            Assert.IsNotNull(animation, "the cloned hero has no Animation");
            Assert.IsNotNull(animation.GetClip("Run"));
            Assert.IsNotNull(animation.GetClip("Jump"));
            Assert.IsNotNull(bootstrap.View.HeroClips, "the player did not take the hero's clips");
            Assert.AreEqual("Run", bootstrap.View.HeroClips.Playing);
            Assert.IsTrue(animation.IsPlaying("Run"));
        }

        [UnityTest]
        public IEnumerator The_legs_trot_diagonal_legs_together_and_the_head_nods()
        {
            yield return Boot();
            var hero = GameObject.Find("Hero").transform;

            var frontL = new List<float>();
            var frontR = new List<float>();
            var backL = new List<float>();
            var headZ = new List<float>();
            // sampled together in one loop, so their phases can be compared
            var legs = new[] { "leg_front_l", "leg_front_r", "leg_back_l", "head" };
            var series = new Dictionary<string, List<float>> { ["leg_front_l"] = frontL, ["leg_front_r"] = frontR, ["leg_back_l"] = backL, ["head"] = headZ };
            var next = Time.realtimeSinceStartup;
            var end = next + 1.2f;
            while (Time.realtimeSinceStartup < end)
            {
                if (Time.realtimeSinceStartup >= next)
                {
                    foreach (var leg in legs) series[leg].Add(Where(hero, leg).z);
                    next += 0.05f;
                }
                yield return null;
            }

            Assert.GreaterOrEqual(frontL.Count, 12, "too few samples to judge the swing");
            Assert.GreaterOrEqual(Range(frontL), 0.1f, "the front left leg barely swings");
            Assert.GreaterOrEqual(Range(frontR), 0.1f, "the front right leg barely swings");
            Assert.GreaterOrEqual(Range(backL), 0.1f, "the back left leg barely swings");
            Assert.GreaterOrEqual(Range(headZ), 0.01f, "the head does not move");
            // trot: a front leg is in opposition to the other front leg, and with the diagonal back leg's opposite (front_l with back_r, so against back_l)
            Assert.Less(Correlation(frontL, frontR), -0.3f, "the front legs move together instead of in opposition");
            Assert.Less(Correlation(frontL, backL), -0.3f, "a front leg and the back leg on its own side move together");
        }

        [UnityTest]
        public IEnumerator Legs_hang_from_the_body_and_stay_attached_while_they_swing()
        {
            yield return Boot();
            var hero = GameObject.Find("Hero").transform;
            var heights = new List<float>();
            var z = new List<float>();
            yield return Sample(hero, "leg_front_l", z, heights);
            // swinging about the hip moves the leg's middle a little up and a lot back and forth, and never far from where it hangs: the swing is a turn about
            // the hip, not a slide away from the body
            Assert.Greater(Range(z), 0.1f);
            Assert.Less(Range(heights), 0.35f, "the leg leaves the body while it swings");
            Assert.Greater(Mean(heights), 0.05f, "the leg is below the ground");
        }

        [UnityTest]
        public IEnumerator Jump_follows_the_air_progress_with_the_legs_tucked_and_Run_returns_on_landing()
        {
            yield return Boot();
            yield return Wait(0.2f);
            var clips = bootstrap.View.HeroClips;
            var hero = GameObject.Find("Hero").transform;
            var animation = hero.GetComponentInChildren<Animation>();
            var before = Where(hero, "leg_front_l");

            bootstrap.Sim.Tick(0.001f, true);
            yield return Wait(0.3f);
            Assert.IsFalse(bootstrap.Sim.Grounded, "the jump already ended");
            Assert.AreEqual("Jump", clips.Playing);
            Assert.AreEqual(bootstrap.Sim.AirProgress, animation["Jump"].normalizedTime, 0.05f);
            Assert.Greater(Vector3.Distance(before, Where(hero, "leg_front_l")), 0.02f, "the front leg did not tuck in the air");

            var deadline = Time.realtimeSinceStartup + 3f;
            while (!bootstrap.Sim.Grounded && Time.realtimeSinceStartup < deadline) yield return null;
            Assert.IsTrue(bootstrap.Sim.Grounded, "the hero never landed");
            yield return Wait(0.3f);
            Assert.AreEqual("Run", clips.Playing);
            Assert.Greater(animation["Run"].weight, 0.9f);
        }

        [UnityTest]
        public IEnumerator A_collectible_turns_with_its_Loop_and_a_crate_stands_still()
        {
            yield return Boot();
            yield return Wait(0.2f);
            var turning = 0;
            var still = 0;
            foreach (var wrapper in Object.FindObjectsByType<Transform>(FindObjectsInactive.Exclude, FindObjectsSortMode.None))
            {
                var animation = wrapper.GetComponentInChildren<Animation>();
                if (wrapper.name == "Collectible")
                {
                    Assert.IsNotNull(animation, "a collectible has no Animation");
                    Assert.IsTrue(animation.IsPlaying("Loop"), "an active collectible is not playing Loop");
                    turning++;
                }
                else if (wrapper.name == "Obstacle")
                {
                    Assert.IsTrue(animation == null || animation.GetClipCount() == 0, "an obstacle with no clips has some");
                    still++;
                }
            }
            Assert.Greater(turning, 0, "no collectible on screen");
            Assert.Greater(still, 0, "no obstacle on screen");
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

        // Pearson's correlation of two series of the same length: 1 together, -1 in opposition.
        static float Correlation(List<float> a, List<float> b)
        {
            var ma = Mean(a);
            var mb = Mean(b);
            float cov = 0, va = 0, vb = 0;
            for (var i = 0; i < a.Count; i++)
            {
                cov += (a[i] - ma) * (b[i] - mb);
                va += (a[i] - ma) * (a[i] - ma);
                vb += (b[i] - mb) * (b[i] - mb);
            }
            return cov / Mathf.Sqrt(va * vb + 1e-9f);
        }
    }
}
