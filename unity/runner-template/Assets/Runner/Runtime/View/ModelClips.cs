using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// The hero's clips. A built model carries Run and (maybe) Jump as legacy clips on the clone's Animation. On the ground it runs; in the
    /// air it shows the Jump clip frozen at the point the real jump has reached (so the pose follows the physics, not a timer); a model with
    /// no Jump clip just keeps running. A model with no Animation, or none with a Run clip, gets no HeroClips and stays as it was.
    /// </summary>
    public sealed class HeroClips
    {
        const string RunName = "Run";
        const string JumpName = "Jump";

        readonly Animation animation;
        readonly bool hasJump;

        HeroClips(Animation animation, bool hasJump)
        {
            this.animation = animation;
            this.hasJump = hasJump;
        }

        /// <summary>The clip being shown ("Run" or "Jump"), or null before the first Update.</summary>
        public string Playing { get; private set; }

        /// <param name="wrapper">What RunnerView moved: the clone with the Animation is inside it.</param>
        public static HeroClips For(Transform wrapper)
        {
            var animation = wrapper == null ? null : wrapper.GetComponentInChildren<Animation>(true);
            if (animation == null || animation.GetClip(RunName) == null) return null;

            animation.playAutomatically = false;
            animation.Stop(); // the importer's default clip may have started on activation
            animation[RunName].wrapMode = WrapMode.Loop;
            var hasJump = animation.GetClip(JumpName) != null;
            if (hasJump) animation[JumpName].wrapMode = WrapMode.ClampForever;
            return new HeroClips(animation, hasJump);
        }

        public void Update(bool grounded, float airProgress)
        {
            if (grounded || !hasJump)
            {
                Show(RunName);
                return;
            }
            Show(JumpName);
            animation[JumpName].normalizedTime = ClipTiming.JumpNormalizedTime(airProgress);
        }

        // Crossfades once per change; the Jump state's speed is 0, so only Update moves its time.
        void Show(string clip)
        {
            if (Playing == clip) return;
            Playing = clip;
            animation.CrossFade(clip, ClipTiming.CrossFadeSeconds);
            if (clip == JumpName) animation[JumpName].speed = 0f;
        }
    }

    /// <summary>The Loop clip of obstacles and collectibles: it plays all the time, each clone starting at its own point.</summary>
    public static class LoopClips
    {
        const string LoopName = "Loop";

        /// <param name="phase01">Where in the clip this clone starts, 0 to 1, so a row of them does not move in lockstep.</param>
        public static void Start(Transform wrapper, float phase01)
        {
            var animation = wrapper == null ? null : wrapper.GetComponentInChildren<Animation>(true);
            var clip = animation == null ? null : animation.GetClip(LoopName);
            if (clip == null) return;

            // The default clip, played automatically, so a pooled clone that is switched off and on again plays again.
            animation.clip = clip;
            animation.playAutomatically = true;
            animation[LoopName].wrapMode = WrapMode.Loop;
            animation.Play(LoopName);
            animation[LoopName].normalizedTime = Mathf.Repeat(phase01, 1f);
        }
    }
}
