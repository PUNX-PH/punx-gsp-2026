using NUnit.Framework;
using Runner.View;
using UnityEngine;

namespace Runner.Tests
{
    public class WorldLookTests
    {
        static readonly Color Sky = new Color(0.106f, 0.122f, 0.231f, 1f);   // #1b1f3b
        static readonly Color Field = new Color(0.024f, 0.839f, 0.627f, 1f); // #06d6a0

        static Vector4[] Colors(WorldLook look) => new[] { look.SunColor, look.SkyTop, look.SkyHorizon, look.AmbSky, look.AmbGround, look.FogColor };

        static bool Finite(Vector4 v) => !(float.IsNaN(v.x) || float.IsNaN(v.y) || float.IsNaN(v.z) || float.IsNaN(v.w) || float.IsInfinity(v.x) || float.IsInfinity(v.y) || float.IsInfinity(v.z));

        [Test]
        public void Both_styles_have_finite_non_negative_colors_and_a_sun_above_the_horizon()
        {
            foreach (var style in WorldLook.Styles)
            {
                var look = WorldLook.For(style, Sky, Field);
                foreach (var color in Colors(look))
                {
                    Assert.IsTrue(Finite(color), style);
                    Assert.GreaterOrEqual(color.x, 0f, style);
                    Assert.GreaterOrEqual(color.y, 0f, style);
                    Assert.GreaterOrEqual(color.z, 0f, style);
                    Assert.AreEqual(1f, color.w, 1e-6f, style + ": a color's alpha is 1");
                }
                Assert.Greater(look.SunDir.y, 0f, style + ": the light comes from above");
                Assert.Greater(look.SkySunDir.y, 0f, style + ": the visible sun is above the horizon");
                Assert.AreEqual(0f, look.SunDir.w, 1e-6f, style + ": a direction's w is 0");
            }
        }

        [Test]
        public void The_fog_starts_before_it_ends_inside_the_camera_range_and_the_exposure_is_sane()
        {
            foreach (var style in WorldLook.Styles)
            {
                var fog = WorldLook.For(style, Sky, Field).FogParams;
                Assert.Greater(fog.x, 0f, style);
                Assert.Less(fog.x, fog.y, style);
                Assert.LessOrEqual(fog.y, 150f, style + ": the camera sees 150 m");
                Assert.Greater(fog.z, 0.4f, style);
                Assert.Less(fog.z, 1.6f, style);
            }
        }

        [Test]
        public void The_desert_is_a_warm_sunset_and_the_meadow_a_blue_day()
        {
            var desert = WorldLook.For("desert", Sky, Field);
            var meadow = WorldLook.For("meadow", Sky, Field);
            Assert.Greater(desert.SkyHorizon.x, desert.SkyHorizon.z, "a red horizon");
            Assert.Greater(meadow.SkyTop.z, meadow.SkyTop.x, "a blue sky");
            Assert.Greater(meadow.SunDir.y, desert.SunDir.y, "the sun is higher by day");
        }

        [Test]
        public void An_unknown_style_is_the_meadow()
        {
            var meadow = WorldLook.For("meadow", Sky, Field);
            var other = WorldLook.For("arctic", Sky, Field);
            Assert.AreEqual(meadow.SkyTop, other.SkyTop);
            Assert.AreEqual(meadow.FogParams, other.FogParams);
        }

        [Test]
        public void The_palette_tints_the_world()
        {
            var plain = WorldLook.For("desert", Sky, Field);
            var other = WorldLook.For("desert", new Color(0.9f, 0.9f, 0.2f, 1f), new Color(0.1f, 0.1f, 0.8f, 1f));
            Assert.AreNotEqual(plain.SkyTop, other.SkyTop);
            Assert.AreNotEqual(plain.SkyHorizon, other.SkyHorizon);
            Assert.AreNotEqual(plain.AmbGround, other.AmbGround);
            Assert.AreNotEqual(plain.FogColor, other.FogColor);
            // what a palette does not choose stays: the sun and the fog distances are the style's
            Assert.AreEqual(plain.SunColor, other.SunColor);
            Assert.AreEqual(plain.SunDir, other.SunDir);
            Assert.AreEqual(plain.FogParams, other.FogParams);
        }

        [Test]
        public void The_same_inputs_give_the_same_look()
        {
            var a = WorldLook.For("desert", Sky, Field);
            var b = WorldLook.For("desert", Sky, Field);
            Assert.AreEqual(a.SkyTop, b.SkyTop);
            Assert.AreEqual(a.AmbSky, b.AmbSky);
            Assert.AreEqual(a.FogColor, b.FogColor);
        }

        [Test]
        public void There_are_two_styles_and_they_are_the_kits()
        {
            Assert.AreEqual(new[] { "desert", "meadow" }, WorldLook.Styles);
        }
    }
}
