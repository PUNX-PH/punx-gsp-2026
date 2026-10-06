using NUnit.Framework;
using Runner.View;

namespace Runner.Tests
{
    public class WorldPlacementTests
    {
        [Test]
        public void TileBase_is_the_last_multiple_of_the_period_not_in_front_of_the_window()
        {
            Assert.AreEqual(-100f, WorldPlacement.TileBase(0f));
            Assert.AreEqual(-100f, WorldPlacement.TileBase(29f));
            Assert.AreEqual(0f, WorldPlacement.TileBase(31f));
            Assert.AreEqual(100f, WorldPlacement.TileBase(130f));
            Assert.AreEqual(900f, WorldPlacement.TileBase(1000f));
        }

        [Test]
        public void TileZ_follows_the_tiles_one_after_another_from_the_base()
        {
            foreach (var heroZ in new[] { 0f, 29f, 31f, 130f, 1000f })
            {
                var tileBase = WorldPlacement.TileBase(heroZ);
                for (var i = 0; i < WorldPlacement.TileCount; i++)
                    Assert.AreEqual(tileBase + 100f * i, WorldPlacement.TileZ(i, heroZ));
            }
        }

        // The ground has to reach from 30 m behind the hero to 170 m ahead of it, at every position.
        [Test]
        public void The_tiles_always_cover_the_window_round_the_hero()
        {
            for (var heroZ = -300f; heroZ <= 1500f; heroZ += 0.5f)
            {
                var start = WorldPlacement.TileZ(0, heroZ);
                var end = WorldPlacement.TileZ(WorldPlacement.TileCount - 1, heroZ) + WorldPlacement.TilePeriod;
                Assert.GreaterOrEqual(heroZ - WorldPlacement.Behind, start, "the ground starts too late at " + heroZ);
                Assert.GreaterOrEqual(end, heroZ + WorldPlacement.Ahead, "the ground ends too soon at " + heroZ);
            }
        }

        // Why there are three: two tiles end short of the window at some positions (the plan's example of a hero at 129 m, 71 m of ground ahead).
        [Test]
        public void Two_tiles_would_leave_a_gap()
        {
            var gaps = 0;
            for (var heroZ = 0f; heroZ < 100f; heroZ += 0.5f)
            {
                var end = WorldPlacement.TileZ(1, heroZ) + WorldPlacement.TilePeriod;
                if (end < heroZ + WorldPlacement.Ahead) gaps++;
            }
            Assert.Greater(gaps, 0);
            Assert.AreEqual(3, WorldPlacement.TileCount);
        }

        // The tiles only ever stand at multiples of the period, so the pattern on them (the dashes, the dunes) is in the same place for every
        // hero position: nothing jumps when a tile is moved to the front.
        [Test]
        public void Tiles_never_pop()
        {
            var previous = WorldPlacement.TileBase(-300f);
            for (var heroZ = -300f; heroZ <= 1500f; heroZ += 0.5f)
            {
                for (var i = 0; i < WorldPlacement.TileCount; i++)
                    Assert.AreEqual(0f, WorldPlacement.TileZ(i, heroZ) % WorldPlacement.TilePeriod, "a tile is off the pattern at " + heroZ);
                var now = WorldPlacement.TileBase(heroZ);
                Assert.IsTrue(now == previous || now == previous + WorldPlacement.TilePeriod, "the base jumped at " + heroZ);
                previous = now;
            }
        }

        [Test]
        public void The_base_does_not_move_backwards_as_the_hero_runs_forwards()
        {
            var previous = float.MinValue;
            for (var heroZ = -300f; heroZ <= 1500f; heroZ += 0.25f)
            {
                var tileBase = WorldPlacement.TileBase(heroZ);
                Assert.GreaterOrEqual(tileBase, previous);
                previous = tileBase;
            }
        }
    }
}
