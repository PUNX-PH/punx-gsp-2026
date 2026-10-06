using NUnit.Framework;
using Runner.Quality;

namespace Runner.Tests
{
    public class QualityLevelsTests
    {
        [Test]
        public void Level_0_draws_everything()
        {
            Assert.AreEqual(0, QualityLevels.SceneryDetail(0));
            Assert.IsTrue(QualityLevels.BackdropVisible(0));
            Assert.IsTrue(QualityLevels.ShadowVisible(0));
            Assert.IsFalse(QualityLevels.Simple(0));
        }

        [Test]
        public void Level_1_hides_every_other_scenery_item_and_nothing_else()
        {
            Assert.AreEqual(1, QualityLevels.SceneryDetail(1));
            Assert.IsTrue(QualityLevels.BackdropVisible(1));
            Assert.IsTrue(QualityLevels.ShadowVisible(1));
            Assert.IsFalse(QualityLevels.Simple(1));
        }

        [Test]
        public void Level_2_also_hides_the_scenery_the_backdrop_and_the_shadow()
        {
            Assert.AreEqual(2, QualityLevels.SceneryDetail(2));
            Assert.IsFalse(QualityLevels.BackdropVisible(2));
            Assert.IsFalse(QualityLevels.ShadowVisible(2));
            Assert.IsFalse(QualityLevels.Simple(2));
        }

        [Test]
        public void Level_3_also_switches_the_lit_shader_to_its_simple_look()
        {
            Assert.AreEqual(2, QualityLevels.SceneryDetail(3));
            Assert.IsFalse(QualityLevels.BackdropVisible(3));
            Assert.IsFalse(QualityLevels.ShadowVisible(3));
            Assert.IsTrue(QualityLevels.Simple(3));
        }

        [Test]
        public void Each_level_does_at_least_what_the_one_before_did()
        {
            for (var level = 1; level <= QualityGovernor.MaxLevel; level++)
            {
                Assert.GreaterOrEqual(QualityLevels.SceneryDetail(level), QualityLevels.SceneryDetail(level - 1));
                if (!QualityLevels.BackdropVisible(level - 1)) Assert.IsFalse(QualityLevels.BackdropVisible(level));
                if (!QualityLevels.ShadowVisible(level - 1)) Assert.IsFalse(QualityLevels.ShadowVisible(level));
                if (QualityLevels.Simple(level - 1)) Assert.IsTrue(QualityLevels.Simple(level));
            }
        }

        [Test]
        public void A_level_outside_the_range_is_the_nearest_one()
        {
            Assert.AreEqual(QualityLevels.SceneryDetail(0), QualityLevels.SceneryDetail(-4));
            Assert.AreEqual(QualityLevels.SceneryDetail(3), QualityLevels.SceneryDetail(9));
            Assert.IsTrue(QualityLevels.Simple(9));
            Assert.IsFalse(QualityLevels.Simple(-1));
        }
    }
}
