using System;
using System.Collections.Generic;

namespace Runner.Quality
{
    /// <summary>
    /// Watches how long frames take and lowers the game's detail when the device cannot keep up. It keeps the frames of the last three seconds; when
    /// their average frame time is above 34 ms (under 30 frames a second) and at least five seconds have passed since the last step, the level goes
    /// up by one, to at most 3. It never goes back down in a session: a game that has had to give up detail once is not given it back to lose it again.
    /// A frame longer than a quarter of a second counts as a quarter of a second, so a tab switch or a page that was in the background is not taken for
    /// slow hardware. Pure: the caller feeds it the frame times and reads the level.
    /// </summary>
    public sealed class QualityGovernor
    {
        public const float WindowSeconds = 3f;
        public const float StepAboveMs = 34f;
        public const float MinGapSeconds = 5f;
        public const int MaxLevel = 3;

        const float LongestFrameSeconds = 0.25f;

        readonly Queue<float> frames = new Queue<float>();
        float total;                         // the seconds the frames in the window add up to
        float sinceStep = MinGapSeconds;     // so the first step needs only a full window

        /// <summary>0 is full detail; each step up lowers it (see QualityLevels).</summary>
        public int Level { get; private set; }

        /// <summary>One frame that took this many seconds. Anything that is not a time (zero, negative, NaN, infinite) is ignored.</summary>
        public void Add(float dtSeconds)
        {
            if (!(dtSeconds > 0f) || float.IsInfinity(dtSeconds)) return;
            var dt = Math.Min(dtSeconds, LongestFrameSeconds);

            frames.Enqueue(dt);
            total += dt;
            sinceStep += dt;
            // forget the oldest frames while what is left still covers the window
            while (frames.Count > 1 && total - frames.Peek() >= WindowSeconds) total -= frames.Dequeue();

            if (Level >= MaxLevel || total < WindowSeconds || sinceStep < MinGapSeconds) return;
            if (total / frames.Count * 1000f > StepAboveMs)
            {
                Level++;
                sinceStep = 0f;
            }
        }
    }
}
