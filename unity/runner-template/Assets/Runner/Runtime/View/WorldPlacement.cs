using System;

namespace Runner.View
{
    /// <summary>
    /// Where the tiles of the High world stand for a hero at a given z. The terrain and the road are one tile 100 m long that repeats (its heights
    /// and normals match at the seam), so a few copies of it, moved by whole tiles as the hero runs, always cover the ground in view. Pure, so it is
    /// tested without a scene.
    /// </summary>
    public static class WorldPlacement
    {
        /// <summary>How long one tile is, in meters: the world's terrain, road and marks all repeat over it.</summary>
        public const float TilePeriod = 100f;

        /// <summary>How far behind the hero the ground has to reach (the camera is 7 m behind the hero).</summary>
        public const float Behind = 30f;

        /// <summary>How far ahead of the hero the ground has to reach (the fog is full at 140 m, the camera sees 150 m).</summary>
        public const float Ahead = 170f;

        /// <summary>
        /// How many copies of a tile there are. Two would cover 200 m, but only when the hero is exactly at a tile's start: a window of 200 m
        /// between tile starts needs three tiles to be covered at every position.
        /// </summary>
        public const int TileCount = 3;

        /// <summary>The z of the first tile: the last multiple of the period that is not in front of the window's start.</summary>
        public static float TileBase(float heroZ)
        {
            return (float)Math.Floor((heroZ - Behind) / TilePeriod) * TilePeriod;
        }

        /// <summary>The z of tile `index` (0 to TileCount - 1): the tiles follow one another from the first.</summary>
        public static float TileZ(int index, float heroZ)
        {
            return TileBase(heroZ) + TilePeriod * index;
        }
    }
}
