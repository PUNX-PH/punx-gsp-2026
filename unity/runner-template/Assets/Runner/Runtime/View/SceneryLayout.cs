using System;

namespace Runner.View
{
    /// <summary>
    /// Where the scenery stands. Pure arithmetic (no Unity types), so it is tested without a scene. Scenery stands in slots along both
    /// sides of the track, one every <c>Spacing</c> metres; a fixed pool of wrappers is recycled by the hero's distance, and every pool
    /// item is always the same model, so nothing pops when a wrapper moves from behind the hero to the far end of the view.
    /// </summary>
    public static class SceneryLayout
    {
        /// <summary>How far behind the hero scenery is kept, in metres.</summary>
        public const float Behind = 10f;

        /// <summary>How far ahead of the hero scenery is kept, in metres (the camera sees about 143 m).</summary>
        public const float Ahead = 145f;

        /// <summary>The distance between two slots on a side, in metres, for a density: few, some or lots.</summary>
        public static float Spacing(string density)
        {
            switch (density)
            {
                case "few": return 30f;
                case "some": return 18f;
                case "lots": return 12f;
                default: throw new ArgumentException("density must be few, some or lots", nameof(density));
            }
        }

        /// <summary>
        /// How many wrappers one side needs: enough slots to cover the view plus one, rounded up to a multiple of the model count so
        /// that a wrapper at pool index i and one at slot s with s % size == i are the same model.
        /// </summary>
        public static int PoolSize(float spacing, int modelCount)
        {
            if (modelCount < 1) throw new ArgumentException("there must be at least one model", nameof(modelCount));
            var needed = (int)Math.Ceiling((Behind + Ahead) / spacing) + 1;
            return (needed + modelCount - 1) / modelCount * modelCount;
        }

        /// <summary>Which of the models stands in this slot of this side (0 left, 1 right); the sides start one model apart.</summary>
        public static int ModelForSlot(int slot, int side, int modelCount)
        {
            return (slot + side) % modelCount;
        }

        /// <summary>The first slot kept for a hero at this z: the one whose distance behind the hero is within <c>Behind</c>.</summary>
        public static int FirstSlot(float heroZ, float spacing)
        {
            return Math.Max(0, (int)Math.Floor((heroZ - Behind) / spacing));
        }

        /// <summary>The z of a slot.</summary>
        public static float SlotZ(int slot, float spacing)
        {
            return slot * spacing;
        }

        /// <summary>The x of a slot: left of the track on side 0, right on side 1, alternating between 7 and 9 m out.</summary>
        public static float SideX(int slot, int side)
        {
            return (side == 0 ? -1f : 1f) * (7f + 2f * (slot % 2));
        }

        /// <summary>The slot pool item <c>item</c> stands in: the first one at or after <c>firstSlot</c> whose number leaves <c>item</c> when divided by the pool size.</summary>
        public static int SlotForItem(int item, int firstSlot, int poolSize)
        {
            return firstSlot + ((item - firstSlot) % poolSize + poolSize) % poolSize;
        }
    }
}
