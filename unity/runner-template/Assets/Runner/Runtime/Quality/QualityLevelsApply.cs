using Runner.View;

namespace Runner.Quality
{
    public static partial class QualityLevels
    {
        /// <summary>
        /// Does a level to the scene. Both views are optional: a game with no environment has no scenery to thin out, and a game with no world has no
        /// backdrop or shadow. The simple look is a shader global, so it reaches every lit material at once.
        /// </summary>
        public static void Apply(int level, EnvironmentView environment, WorldView world)
        {
            environment?.SetSceneryDetail(SceneryDetail(level));
            if (world != null)
            {
                world.BackdropVisible = BackdropVisible(level);
                world.ShadowVisible = ShadowVisible(level);
            }
            WorldLook.SetSimple(Simple(level));
        }
    }
}
