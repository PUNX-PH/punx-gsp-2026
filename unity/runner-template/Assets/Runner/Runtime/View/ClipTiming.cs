namespace Runner.View
{
    /// <summary>The timing rules for a model's clips, with no Unity types so they are tested without a scene.</summary>
    public static class ClipTiming
    {
        /// <summary>How long the hero takes to blend between Run and Jump, in seconds.</summary>
        public const float CrossFadeSeconds = 0.08f;

        /// <summary>The Jump clip's normalized time for how far through the jump the hero is (RunnerSim.AirProgress): 0 to 1, nothing else.</summary>
        public static float JumpNormalizedTime(float airProgress)
        {
            if (!(airProgress > 0f)) return 0f; // also catches NaN
            return airProgress < 1f ? airProgress : 1f;
        }
    }
}
