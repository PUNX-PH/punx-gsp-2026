using NUnit.Framework;
using Runner.View;
using UnityEngine;
using Object = UnityEngine.Object;

namespace Runner.Tests
{
    public class ClipTests
    {
        GameObject root;

        [TearDown]
        public void TearDown()
        {
            if (root != null) Object.DestroyImmediate(root);
        }

        // A wrapper holding a clone with an Animation, the way RunnerView wraps a model; each name gets a legacy one-second clip.
        Transform ModelWith(params string[] clips)
        {
            root = new GameObject("Wrapper");
            var model = new GameObject("Clone");
            model.transform.SetParent(root.transform, false);
            var animation = model.AddComponent<Animation>();
            animation.playAutomatically = false;
            foreach (var name in clips)
            {
                var clip = new AnimationClip { name = name, legacy = true };
                clip.SetCurve("", typeof(Transform), "localPosition.y", AnimationCurve.Linear(0f, 0f, 1f, 1f));
                animation.AddClip(clip, name);
            }
            return root.transform;
        }

        [Test]
        public void JumpNormalizedTime_clamps_and_passes_the_progress()
        {
            Assert.AreEqual(0f, ClipTiming.JumpNormalizedTime(-0.2f));
            Assert.AreEqual(0.4f, ClipTiming.JumpNormalizedTime(0.4f), 1e-6f);
            Assert.AreEqual(1f, ClipTiming.JumpNormalizedTime(1.3f));
            Assert.AreEqual(0f, ClipTiming.JumpNormalizedTime(float.NaN));
        }

        [Test]
        public void HeroClips_is_null_without_an_Animation_or_without_Run()
        {
            root = new GameObject("Bare");
            Assert.IsNull(HeroClips.For(root.transform));
            Object.DestroyImmediate(root);
            Assert.IsNull(HeroClips.For(ModelWith("Loop")));
        }

        [Test]
        public void LoopClips_ignores_a_model_without_Loop()
        {
            root = new GameObject("Bare");
            Assert.DoesNotThrow(() => LoopClips.Start(root.transform, 0.5f));
            Object.DestroyImmediate(root);

            var wrapper = ModelWith("Run");
            Assert.DoesNotThrow(() => LoopClips.Start(wrapper, 0.5f));
            Assert.IsFalse(wrapper.GetComponentInChildren<Animation>().isPlaying);
        }

        [Test]
        public void HeroClips_runs_on_the_ground_and_follows_the_jump_in_the_air()
        {
            var clips = HeroClips.For(ModelWith("Run", "Jump"));
            var animation = root.GetComponentInChildren<Animation>();
            Assert.IsNotNull(clips);
            Assert.IsNull(clips.Playing);

            clips.Update(true, 0f);
            Assert.AreEqual("Run", clips.Playing);
            Assert.AreEqual(WrapMode.Loop, animation["Run"].wrapMode);

            clips.Update(false, 0.4f);
            Assert.AreEqual("Jump", clips.Playing);
            Assert.AreEqual(0f, animation["Jump"].speed);
            Assert.AreEqual(0.4f, animation["Jump"].normalizedTime, 1e-4f);
            clips.Update(false, 0.8f);
            Assert.AreEqual(0.8f, animation["Jump"].normalizedTime, 1e-4f);

            clips.Update(true, 0f);
            Assert.AreEqual("Run", clips.Playing);
        }

        [Test]
        public void HeroClips_keeps_running_in_the_air_when_there_is_no_Jump_clip()
        {
            var clips = HeroClips.For(ModelWith("Run"));
            clips.Update(true, 0f);
            clips.Update(false, 0.5f);
            Assert.AreEqual("Run", clips.Playing);
        }

        [Test]
        public void LoopClips_plays_Loop_from_the_phase_and_keeps_playing_when_the_clone_is_reactivated()
        {
            var wrapper = ModelWith("Loop", "Run");
            LoopClips.Start(wrapper, 0.25f);
            var animation = wrapper.GetComponentInChildren<Animation>();
            Assert.IsTrue(animation.IsPlaying("Loop"));
            Assert.IsFalse(animation.IsPlaying("Run"));
            Assert.AreEqual(0.25f, animation["Loop"].normalizedTime, 1e-4f);
            Assert.AreEqual(WrapMode.Loop, animation["Loop"].wrapMode);
            Assert.IsTrue(animation.playAutomatically);
            Assert.AreEqual("Loop", animation.clip.name);
        }
    }
}
