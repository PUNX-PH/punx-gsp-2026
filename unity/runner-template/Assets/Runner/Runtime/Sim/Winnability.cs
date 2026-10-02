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
            // All in double, from the float values the settings file gave. In float arithmetic the Editor (Mono keeps
            // intermediate sums at higher precision) and the WebGL player (IL2CPP rounds every operation) disagreed
            // on a few tunings that sit exactly on an edge, such as speed 6.25, jumpHeight 3.75, spacing 7.5. Double
            // arithmetic is the same everywhere, and the web app's validator does exactly this too.
            double speed = t.speed, jumpHeight = t.jumpHeight, obstacleSpacing = t.obstacleSpacing;
            const double g = RunnerSim.Gravity;
            const double top = RunnerSim.ObstacleHeight;
            const double hitWidth = 2.0 * RunnerSim.HitHalfWidth;
            const double window = MinTimingWindow;

            // Seconds one jump spends above the top of an obstacle, against what the hit window and the margin need.
            var excess = Math.Max(0.0, jumpHeight - top);
            var above = 2.0 * Math.Sqrt(2.0 * excess / g);
            var needed = hitWidth / speed + window;
            if (above < needed)
            {
                var minHeight = top + g * needed * needed / 8.0;
                return $"settings.tuning.jumpHeight: {F(jumpHeight)} m is too low to jump an obstacle at {F(speed)} m/s " +
                       $"with a {F(window * 1000.0)} ms timing margin; use at least {F(RoundUp(minHeight))} m or a higher speed";
            }

            // One jump per obstacle: the hero must be back on the ground, with the margin to spare, before the next
            // take-off. If the gap between obstacles is shorter than a whole jump, each landing comes a little later
            // than the next ideal take-off, the timing drifts, and sooner or later a window is missed.
            var airTime = 2.0 * Math.Sqrt(2.0 * jumpHeight / g);
            var minSpacing = speed * (airTime + window);
            if (obstacleSpacing < minSpacing)
            {
                return $"settings.tuning.obstacleSpacing: {F(obstacleSpacing)} m is too short at {F(speed)} m/s, the hero needs " +
                       $"room to land and jump again; use at least {F(RoundUp(minSpacing))} m or a lower speed";
            }
            return null;
        }

        // Rounded up to 0.1 so that the value in the message passes the check itself.
        static double RoundUp(double value) => Math.Ceiling(value * 10.0) / 10.0;

        static string F(double value) => value.ToString("0.##", CultureInfo.InvariantCulture);
    }
}
