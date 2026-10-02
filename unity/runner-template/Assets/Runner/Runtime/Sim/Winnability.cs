using System;
using System.Globalization;
using Runner.Settings;

namespace Runner.Sim
{
    /// <summary>
    /// Rejects tunings that are each inside their own range but together make a game nobody can win. A jump only
    /// clears an obstacle while the hero is above its top for the whole 1.6 m hit window, so a slow hero or a low
    /// jump leaves no moment to jump at, and obstacles closer together than one whole jump leave no room to land
    /// and jump again. The player must always have a take-off window of at least MinTimingWindow seconds. The rule
    /// assumes one jump per obstacle; it turns away some tunings a player could beat by clearing several obstacles
    /// with one long jump, which is the safe side for settings that will be generated.
    /// </summary>
    public static class Winnability
    {
        public const float MinTimingWindow = 0.2f;

        /// <summary>Null when the tuning can be played, otherwise a settings error naming the value to change.</summary>
        public static string Check(Tuning t)
        {
            const float g = RunnerSim.Gravity;
            const float top = RunnerSim.ObstacleHeight;
            const float hitWidth = 2f * RunnerSim.HitHalfWidth;

            // Seconds one jump spends above the top of an obstacle, and seconds from take-off until it gets there.
            var excess = Math.Max(0f, t.jumpHeight - top);
            var above = 2f * (float)Math.Sqrt(2f * excess / g);
            var needed = hitWidth / t.speed + MinTimingWindow;
            if (above < needed)
            {
                var minHeight = top + g * needed * needed / 8f;
                return $"settings.tuning.jumpHeight: {F(t.jumpHeight)} m is too low to jump an obstacle at {F(t.speed)} m/s " +
                       $"with a {F(MinTimingWindow * 1000f)} ms timing margin; use at least {F(RoundUp(minHeight))} m or a higher speed";
            }

            // One jump per obstacle: the hero must be back on the ground, with the margin to spare, before the next
            // take-off. If the gap between obstacles is shorter than a whole jump, each landing comes a little later
            // than the next ideal take-off, the timing drifts, and sooner or later a window is missed.
            var airTime = 2f * (float)Math.Sqrt(2f * t.jumpHeight / g);
            var minSpacing = t.speed * (airTime + MinTimingWindow);
            if (t.obstacleSpacing < minSpacing)
            {
                return $"settings.tuning.obstacleSpacing: {F(t.obstacleSpacing)} m is too short at {F(t.speed)} m/s, the hero needs " +
                       $"room to land and jump again; use at least {F(RoundUp(minSpacing))} m or a lower speed";
            }
            return null;
        }

        // Rounded up to 0.1 so that the value in the message passes the check itself.
        static float RoundUp(float value) => (float)Math.Ceiling(value * 10f) / 10f;

        static string F(float value) => value.ToString("0.##", CultureInfo.InvariantCulture);
    }
}
