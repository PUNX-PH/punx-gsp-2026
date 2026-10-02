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
            return CheckRange("speed", s.tuning.speed, 1f, 20f)
                   ?? CheckRange("jumpHeight", s.tuning.jumpHeight, 1.5f, 5f)
                   ?? CheckRange("obstacleSpacing", s.tuning.obstacleSpacing, 4f, 40f)
                   ?? Winnability.Check(s.tuning); // the three values together, once each is in range
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
