using System;
using NUnit.Framework;
using Runner.View;

namespace Runner.Tests
{
    public class SceneryLayoutTests
    {
        static readonly string[] Densities = { "few", "some", "lots" };

        [Test]
        public void Spacing_by_density()
        {
            Assert.AreEqual(30f, SceneryLayout.Spacing("few"));
            Assert.AreEqual(18f, SceneryLayout.Spacing("some"));
            Assert.AreEqual(12f, SceneryLayout.Spacing("lots"));
            Assert.Throws<ArgumentException>(() => SceneryLayout.Spacing("many"));
            Assert.Throws<ArgumentException>(() => SceneryLayout.Spacing("Some"));
            Assert.Throws<ArgumentException>(() => SceneryLayout.Spacing(""));
            Assert.Throws<ArgumentException>(() => SceneryLayout.Spacing(null));
        }

        [Test]
        public void The_view_runs_from_10_m_behind_the_hero_to_145_m_ahead()
        {
            Assert.AreEqual(10f, SceneryLayout.Behind);
            Assert.AreEqual(145f, SceneryLayout.Ahead);
        }

        [Test]
        public void Pool_covers_the_view_and_is_a_multiple_of_the_model_count()
        {
            foreach (var density in Densities)
            {
                var spacing = SceneryLayout.Spacing(density);
                for (var models = 1; models <= 3; models++)
                {
                    var size = SceneryLayout.PoolSize(spacing, models);
                    Assert.GreaterOrEqual(size * spacing, SceneryLayout.Behind + SceneryLayout.Ahead + spacing, density + " x " + models);
                    Assert.AreEqual(0, size % models, density + " x " + models);
                }
            }
        }

        [Test]
        public void Pool_sizes_for_each_density_and_one_to_three_models()
        {
            // ceil(155 / spacing) + 1, then up to a multiple of the model count
            Assert.AreEqual(7, SceneryLayout.PoolSize(30f, 1));
            Assert.AreEqual(8, SceneryLayout.PoolSize(30f, 2));
            Assert.AreEqual(9, SceneryLayout.PoolSize(30f, 3));
            Assert.AreEqual(10, SceneryLayout.PoolSize(18f, 1));
            Assert.AreEqual(14, SceneryLayout.PoolSize(12f, 1));
            Assert.AreEqual(14, SceneryLayout.PoolSize(12f, 2));
            Assert.AreEqual(15, SceneryLayout.PoolSize(12f, 3));
        }

        [Test]
        public void A_pool_item_never_changes_model()
        {
            foreach (var density in Densities)
            {
                var spacing = SceneryLayout.Spacing(density);
                for (var models = 1; models <= 3; models++)
                {
                    var size = SceneryLayout.PoolSize(spacing, models);
                    for (var side = 0; side < 2; side++)
                    {
                        for (var slot = 0; slot <= 500; slot++)
                        {
                            Assert.AreEqual(SceneryLayout.ModelForSlot(slot % size, side, models), SceneryLayout.ModelForSlot(slot, side, models),
                                density + " x " + models + ", side " + side + ", slot " + slot);
                        }
                    }
                }
            }
        }

        [Test]
        public void Model_for_slot_alternates_along_a_side_and_differs_between_the_sides()
        {
            Assert.AreEqual(0, SceneryLayout.ModelForSlot(0, 0, 3));
            Assert.AreEqual(1, SceneryLayout.ModelForSlot(1, 0, 3));
            Assert.AreEqual(2, SceneryLayout.ModelForSlot(2, 0, 3));
            Assert.AreEqual(0, SceneryLayout.ModelForSlot(3, 0, 3));
            Assert.AreEqual(1, SceneryLayout.ModelForSlot(0, 1, 3)); // the other side starts one model along
            Assert.AreEqual(0, SceneryLayout.ModelForSlot(7, 0, 1)); // one model: always the same
        }

        [Test]
        public void Scenery_stands_outside_the_track()
        {
            for (var slot = 0; slot < 200; slot++)
            {
                for (var side = 0; side < 2; side++)
                    Assert.GreaterOrEqual(Math.Abs(SceneryLayout.SideX(slot, side)), 7f, "slot " + slot + ", side " + side);
                Assert.Less(SceneryLayout.SideX(slot, 0), 0f);
                Assert.Greater(SceneryLayout.SideX(slot, 1), 0f);
            }
        }

        [Test]
        public void Side_x_staggers_the_slots_between_7_and_9_m()
        {
            Assert.AreEqual(-7f, SceneryLayout.SideX(0, 0));
            Assert.AreEqual(7f, SceneryLayout.SideX(0, 1));
            Assert.AreEqual(-9f, SceneryLayout.SideX(1, 0));
            Assert.AreEqual(9f, SceneryLayout.SideX(1, 1));
            Assert.AreEqual(-7f, SceneryLayout.SideX(2, 0));
        }

        [Test]
        public void First_slot_follows_the_hero()
        {
            Assert.AreEqual(0, SceneryLayout.FirstSlot(0f, 12f));
            Assert.AreEqual(0, SceneryLayout.FirstSlot(-50f, 12f)); // never before the first slot
            Assert.AreEqual(0, SceneryLayout.FirstSlot(21.9f, 12f));
            Assert.AreEqual(1, SceneryLayout.FirstSlot(22f, 12f));
            Assert.AreEqual(7, SceneryLayout.FirstSlot(100f, 12f));
        }

        [Test]
        public void Slot_z_is_the_slot_times_the_spacing()
        {
            Assert.AreEqual(0f, SceneryLayout.SlotZ(0, 18f));
            Assert.AreEqual(54f, SceneryLayout.SlotZ(3, 18f));
            Assert.AreEqual(360f, SceneryLayout.SlotZ(12, 30f));
        }

        [Test]
        public void The_slot_a_pool_item_stands_at_is_the_first_one_at_or_after_the_first_slot_that_is_its_own()
        {
            foreach (var first in new[] { 0, 1, 6, 7, 13, 100 })
            {
                const int size = 10;
                for (var item = 0; item < size; item++)
                {
                    var slot = SceneryLayout.SlotForItem(item, first, size);
                    Assert.GreaterOrEqual(slot, first, "first " + first + ", item " + item);
                    Assert.Less(slot, first + size, "first " + first + ", item " + item);
                    Assert.AreEqual(item, slot % size, "first " + first + ", item " + item);
                }
            }
        }
    }
}
