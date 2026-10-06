using System;
using System.Collections.Generic;
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
        static readonly string[] Looks = { "flat", "lit" };
        static readonly string[] WorldStyles = { "desert", "meadow" };

        /// <summary>The three files of a world, next to settings.json, whatever its style.</summary>
        public static readonly string[] WorldFiles = { "terrain.glb", "road.glb", "backdrop.glb" };
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

            // The look and the world are optional and are read from the text itself (see JsonKeys): a value of the wrong type is then an error, not
            // an empty default.
            var scan = JsonKeys.Scan(json);
            settings.look = scan.String("look");
            if (settings.environment != null)
            {
                var style = scan.String("environment.world.style");
                settings.environment.world = style == null ? null : new WorldSettings { style = style };
            }

            var error = Validate(settings, scan);
            return error == null ? new ParseResult { Ok = true, Settings = settings } : Fail(error);
        }

        static ParseResult Fail(string error) => new ParseResult { Ok = false, Error = error };

        // JsonUtility fills missing fields with defaults, so absence shows up as null, "" or 0 here.
        static string Validate(GameSettings s, JsonScan scan)
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
            if (tuningError != null) return tuningError;

            var lookError = CheckLook(scan);
            if (lookError != null) return lookError;

            if (!HasEnvironment(s)) return null;
            return CheckEnvironment(s.environment, scan);
        }

        /// <summary>Whether the game is lit (the High look). Absent or "flat" is the plain look every game had.</summary>
        public static bool IsLit(GameSettings s) => s.look == "lit";

        // The look is optional, but if the file writes one it must be flat or lit, whatever type it was written in.
        static string CheckLook(JsonScan scan)
        {
            if (!scan.HasKey("look") || Array.IndexOf(Looks, scan.String("look")) >= 0) return null;
            return $"settings.look: {Shown(scan, "look")} must be flat or lit";
        }

        // What a value looked like in the text, cut short like the web validator's messages ("lit" with its quotes, 3, null), "missing" when the
        // key is not there, and a word for an object or a list.
        static string Shown(JsonScan scan, string path)
        {
            if (scan.Values.TryGetValue(path, out var raw)) return raw.Length > 40 ? raw.Substring(0, 40) : raw;
            return scan.HasKey(path) ? "an object or a list" : "missing";
        }

        /// <summary>
        /// Whether the file carried an environment. JsonUtility gives every nested object a default instance, so "absent" is an
        /// environment whose density was never set (a file that has one always names its density).
        /// </summary>
        public static bool HasEnvironment(GameSettings s)
        {
            return s.environment != null && !string.IsNullOrEmpty(s.environment.density);
        }

        /// <summary>Whether the environment has a world (a High one): a style was written for it.</summary>
        public static bool HasWorld(GameSettings s)
        {
            return HasEnvironment(s) && s.environment.world != null && !string.IsNullOrEmpty(s.environment.world.style);
        }

        static string CheckEnvironment(EnvironmentSettings e, JsonScan scan)
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
            return CheckWorld(scan);
        }

        // The world is exactly { style }, and anything else inside it is refused, which JsonUtility could not see.
        static string CheckWorld(JsonScan scan)
        {
            if (!scan.HasKey("environment.world")) return null;
            if (!scan.Keys.TryGetValue("environment.world", out var worldKeys)) return "settings.environment.world: must be an object with a style";
            foreach (var key in worldKeys)
                if (key != "style") return $"settings.environment.world: unknown field \"{key}\" (only style is allowed)";
            if (Array.IndexOf(WorldStyles, scan.String("environment.world.style")) >= 0) return null;
            return $"settings.environment.world.style: {Shown(scan, "environment.world.style")} must be desert or meadow";
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
