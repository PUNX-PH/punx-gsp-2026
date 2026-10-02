using System.IO;
using NUnit.Framework;
using Runner.Settings;
using UnityEngine;

namespace Runner.Tests
{
    public class SettingsParserTests
    {
        // Application.dataPath is <repo>/unity/runner-template/Assets, so the repo root is three levels up.
        static string Fixture(string name) =>
            File.ReadAllText(Path.GetFullPath(Path.Combine(Application.dataPath, "../../../fixtures/settings", name)));

        static void AssertRejected(string fixture, string expectedInError)
        {
            var result = SettingsParser.Parse(Fixture(fixture));
            Assert.IsFalse(result.Ok, fixture + " should be rejected");
            StringAssert.Contains(expectedInError, result.Error);
        }

        static void AssertAccepted(string fixture)
        {
            var result = SettingsParser.Parse(Fixture(fixture));
            Assert.IsTrue(result.Ok, fixture + " should be accepted but got: " + result.Error);
        }

        [Test]
        public void Parse_valid_fixture_returns_settings()
        {
            var result = SettingsParser.Parse(Fixture("valid.json"));
            Assert.IsTrue(result.Ok, result.Error);
            var s = result.Settings;
            Assert.AreEqual("runner", s.template);
            Assert.AreEqual(5, s.palette.Length);
            Assert.AreEqual("hero.glb", s.roles.hero);
            Assert.AreEqual(6f, s.tuning.speed, 1e-5f);
            Assert.AreEqual(2.2f, s.tuning.jumpHeight, 1e-5f);
            Assert.AreEqual(12f, s.tuning.obstacleSpacing, 1e-5f);
        }

        [Test] public void Parse_ignores_unknown_extra_fields() => AssertAccepted("valid-extra-fields.json");

        [Test] public void Parse_rejects_malformed_json() => AssertRejected("invalid-malformed-json.json", "not valid JSON");
        [Test] public void Parse_rejects_schema_version_2() => AssertRejected("invalid-schema-version-2.json", "schemaVersion");
        [Test] public void Parse_rejects_unknown_template() => AssertRejected("invalid-unknown-template.json", "template");
        [Test] public void Parse_rejects_four_colors() => AssertRejected("invalid-palette-four-colors.json", "palette");
        [Test] public void Parse_rejects_bad_hex() => AssertRejected("invalid-palette-bad-hex.json", "palette");
        [Test] public void Parse_rejects_missing_roles() => AssertRejected("invalid-roles-missing.json", "roles");

        [Test]
        public void Parse_rejects_role_with_path()
        {
            AssertRejected("invalid-role-path-parent.json", "roles.hero");
            AssertRejected("invalid-role-path-subfolder.json", "roles.hero");
        }

        [Test] public void Parse_rejects_role_not_glb() => AssertRejected("invalid-role-not-glb.json", "roles.hero");
        [Test] public void Parse_rejects_speed_0() => AssertRejected("invalid-speed-0.json", "speed");
        [Test] public void Parse_rejects_speed_21() => AssertRejected("invalid-speed-21.json", "speed");
        [Test] public void Parse_rejects_jumpHeight_1() => AssertRejected("invalid-jump-height-1.json", "jumpHeight");
        [Test] public void Parse_rejects_spacing_3() => AssertRejected("invalid-spacing-3.json", "obstacleSpacing");

        [Test]
        public void Parse_rejects_empty_document()
        {
            foreach (var text in new[] { "", "   " })
            {
                var result = SettingsParser.Parse(text);
                Assert.IsFalse(result.Ok, "'" + text + "' should be rejected");
                StringAssert.Contains("not valid JSON", result.Error);
            }
        }

        [Test]
        public void Parse_rejects_html_error_page()
        {
            var result = SettingsParser.Parse("<!DOCTYPE html><html><body>404 Not Found</body></html>");
            Assert.IsFalse(result.Ok);
            StringAssert.Contains("not valid JSON", result.Error);
        }

        [Test]
        public void Parse_accepts_the_playable_extremes()
        {
            AssertAccepted("valid-playable-low.json");
            AssertAccepted("valid-range-max.json");
        }

        // Each value is inside its own range, but together they make a game nobody can win.
        [Test] public void Parse_rejects_a_jump_that_cannot_clear_an_obstacle() => AssertRejected("invalid-unwinnable-jump.json", "jumpHeight");
        [Test] public void Parse_rejects_spacing_too_short_to_land_and_jump_again() => AssertRejected("invalid-unwinnable-spacing.json", "obstacleSpacing");
    }
}
