using System;
using System.Globalization;
using System.Text.RegularExpressions;
using Runner.Sim;
using UnityEngine;

namespace Runner.Settings
{
    public sealed class ParseResult
    {
        public bool Ok;
        public GameSettings Settings;
        public string Error;
    }

    public static class SettingsParser
    {
        const int SupportedVersion = 1;
        const int MaxScenery = 3;
        static readonly string[] Densities = { "few", "some", "lots" };
        static readonly Regex HexColor = new Regex("^#[0-9a-fA-F]{6}$");
        static readonly Regex GlbFileName = new Regex("^[A-Za-z0-9_-]+\\.[Gg][Ll][Bb]$");

        public static ParseResult Parse(string json)
        {
            GameSettings settings;
            try
            {
                settings = JsonUtility.FromJson<GameSettings>(json);
            }
            catch (ArgumentException e)
            {
                return Fail("settings: not valid JSON (" + e.Message + ")");
            }
            if (settings == null) return Fail("settings: not valid JSON (empty document)");

            var error = Validate(settings);
            return error == null ? new ParseResult { Ok = true, Settings = settings } : Fail(error);
        }

        static ParseResult Fail(string error) => new ParseResult { Ok = false, Error = error };

        // JsonUtility fills missing fields with defaults, so absence shows up as null, "" or 0 here.
        static string Validate(GameSettings s)
        {
            if (s.schemaVersion != SupportedVersion)
                return $"settings.schemaVersion: {s.schemaVersion} is not supported (expected {SupportedVersion})";
            if (s.template != "runner")
                return $"settings.template: \"{s.template}\" is not supported (expected \"runner\")";

            if (s.palette == null || s.palette.Length != 5)
                return $"settings.palette: expected 5 colors like #rrggbb, found {(s.palette == null ? 0 : s.palette.Length)}";
            for (var i = 0; i < s.palette.Length; i++)
                if (s.palette[i] == null || !HexColor.IsMatch(s.palette[i]))
                    return $"settings.palette[{i}]: \"{s.palette[i]}\" is not a #rrggbb color";

            if (s.roles == null) return "settings.roles: missing";
            var roleError = CheckRole("hero", s.roles.hero)
                            ?? CheckRole("obstacle", s.roles.obstacle)
                            ?? CheckRole("collectible", s.roles.collectible);
            if (roleError != null) return roleError;

            if (s.tuning == null) return "settings.tuning: missing";
            var tuningError = CheckRange("speed", s.tuning.speed, 1f, 20f)
                              ?? CheckRange("jumpHeight", s.tuning.jumpHeight, 1.5f, 5f)
                              ?? CheckRange("obstacleSpacing", s.tuning.obstacleSpacing, 4f, 40f)
                              ?? Winnability.Check(s.tuning); // the three values together, once each is in range
            if (tuningError != null || !HasEnvironment(s)) return tuningError;
            return CheckEnvironment(s.environment);
        }

        /// <summary>
        /// Whether the file carried an environment. JsonUtility gives every nested object a default instance, so "absent" is an
        /// environment whose density was never set (a file that has one always names its density).
        /// </summary>
        public static bool HasEnvironment(GameSettings s)
        {
            return s.environment != null && !string.IsNullOrEmpty(s.environment.density);
        }

        static string CheckEnvironment(EnvironmentSettings e)
        {
            var error = CheckPaletteIndex("sky", e.sky) ?? CheckPaletteIndex("field", e.field) ?? CheckPaletteIndex("stripe", e.stripe);
            if (error != null) return error;
            if (Array.IndexOf(Densities, e.density) < 0)
                return $"settings.environment.density: \"{e.density}\" must be few, some or lots";

            var scenery = e.scenery ?? new string[0]; // a missing list counts as no scenery
            if (scenery.Length > MaxScenery)
                return $"settings.environment.scenery: at most {MaxScenery} files, found {scenery.Length}";
            for (var i = 0; i < scenery.Length; i++)
                if (scenery[i] == null || !GlbFileName.IsMatch(scenery[i]))
                    return $"settings.environment.scenery[{i}]: \"{scenery[i]}\" must be a plain file name like scenery1.glb (letters, digits, - and _ only)";
            return null;
        }

        static string CheckPaletteIndex(string name, int value)
        {
            if (value >= 0 && value <= 4) return null;
            return $"settings.environment.{name}: {value} is not a palette index (0 to 4)";
        }

        static string CheckRole(string role, string file)
        {
            if (string.IsNullOrEmpty(file)) return $"settings.roles.{role}: missing";
            if (!GlbFileName.IsMatch(file))
                return $"settings.roles.{role}: \"{file}\" must be a plain file name like {role}.glb (letters, digits, - and _ only)";
            return null;
        }

        static string CheckRange(string name, float value, float min, float max)
        {
            if (value >= min && value <= max) return null; // false for NaN too
            return string.Format(CultureInfo.InvariantCulture,
                "settings.tuning.{0}: {1} is outside {2} to {3}", name, value, min, max);
        }
    }
}
