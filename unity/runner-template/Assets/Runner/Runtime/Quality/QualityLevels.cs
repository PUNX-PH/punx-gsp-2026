using System;

namespace Runner.Quality
{
    /// <summary>
    /// What each level of the quality governor does (the rules, which are pure; QualityLevelsApply.cs does them to the scene). Level 1 hides every
    /// other scenery item; level 2 also hides the scenery, the backdrop and the shadow under the hero; level 3 also switches the lit shader to its
    /// simple look.
    /// </summary>
    public static partial class QualityLevels
    {
        /// <summary>How much of the scenery is drawn: 0 all of it, 1 every other item, 2 none.</summary>
        public static int SceneryDetail(int level) => Math.Min(2, Math.Max(0, level));

        public static bool BackdropVisible(int level) => level < 2;

        public static bool ShadowVisible(int level) => level < 2;

        /// <summary>Whether the lit shader keeps only wrapped diffuse, ambient light and fog.</summary>
        public static bool Simple(int level) => level >= 3;
    }
}
