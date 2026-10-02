namespace Runner.Loading
{
    /// <summary>
    /// A time limit counted in frames. Web builds have no timers, and Time.unscaledTime is cached per frame, so a
    /// frame that takes a minute (a WebGL player's first one can) would use up the whole limit at once. Each frame
    /// therefore adds at most maxStepSeconds.
    /// </summary>
    public sealed class FrameTimeout
    {
        readonly float limit;
        readonly float maxStep;

        public FrameTimeout(float limitSeconds, float maxStepSeconds = 0.25f)
        {
            limit = limitSeconds;
            maxStep = maxStepSeconds;
        }

        public float Elapsed { get; private set; }

        /// <summary>Adds one frame's time (pass Time.unscaledDeltaTime). True once the limit is reached.</summary>
        public bool Tick(float deltaSeconds)
        {
            Elapsed += deltaSeconds < maxStep ? deltaSeconds : maxStep;
            return Elapsed >= limit;
        }
    }
}
