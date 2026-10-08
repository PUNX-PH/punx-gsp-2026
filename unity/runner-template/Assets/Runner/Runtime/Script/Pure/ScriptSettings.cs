using System.Collections.Generic;
using System.Text.RegularExpressions;
using Runner.Engine;

namespace Runner.Scripting
{
    /// <summary>What the "script" key of a settings file said (and the palette beside it), or why it could not be used.</summary>
    public sealed class ScriptRead
    {
        /// <summary>Whether the settings carry a "script" key at all (a file without one is not a script game).</summary>
        public bool Present;

        public string File;
        public List<string> Models = new List<string>();
        public string[] Palette = ScriptSettings.DefaultPalette();
        public string Error;
    }

    /// <summary>
    /// Reads <c>"script": { "file": "game.lua", "models": ["hero", "coin"] }</c>: the Lua file next to the settings and the names of the models
    /// (entity-NAME.glb next to the settings) the script may spawn. The names are limited so that they cannot point anywhere but at a file beside the
    /// settings. The palette is the settings' own five colors; a missing or malformed one is replaced by a default rather than stopping a game.
    /// Pure C#, no Unity types.
    /// </summary>
    public static class ScriptSettings
    {
        public const int MaxModels = 6;

        static readonly Regex FileName = new Regex(@"^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}\.lua$");
        static readonly Regex ModelName = new Regex(@"^[a-z][a-zA-Z0-9]{0,15}$");
        static readonly Regex HexColor = new Regex(@"^#[0-9a-fA-F]{6}$");

        public static string[] DefaultPalette() => new[] { "#1b1f3b", "#ff6b6b", "#ffd166", "#06d6a0", "#f1faee" };

        public static ScriptRead Read(string json)
        {
            if (string.IsNullOrEmpty(json) || !MiniJson.TryParse(json, out var root, out _) || !(root is JsonObject top) || !top.Has("script")) return new ScriptRead();
            var read = new ScriptRead { Present = true };
            read.Palette = ReadPalette(top.Get("palette")) ?? read.Palette;

            if (!(top.Get("script") is JsonObject script))
            {
                read.Error = "settings.script must be an object like { \"file\": \"game.lua\" }.";
                return read;
            }
            if (!(script.Get("file") is string file) || !FileName.IsMatch(file))
            {
                read.Error = "settings.script.file must be the name of a .lua file next to the settings, such as \"game.lua\".";
                return read;
            }
            read.File = file;

            var models = script.Get("models");
            if (models == null) return read;
            if (!(models is List<object> list))
            {
                read.Error = "settings.script.models must be a list of model names.";
                return read;
            }
            foreach (var item in list)
            {
                if (!(item is string name) || !ModelName.IsMatch(name))
                {
                    read.Error = "settings.script.models: every model name must be like \"hero\" (a lowercase letter, then letters and digits, 16 at most).";
                    return read;
                }
                if (!read.Models.Contains(name)) read.Models.Add(name);
            }
            if (read.Models.Count > MaxModels) read.Error = "settings.script.models: at most " + MaxModels + " models.";
            return read;
        }

        static string[] ReadPalette(object value)
        {
            if (!(value is List<object> list) || list.Count != 5) return null;
            var colors = new string[5];
            for (var i = 0; i < 5; i++)
            {
                if (!(list[i] is string hex) || !HexColor.IsMatch(hex)) return null;
                colors[i] = hex.ToLowerInvariant();
            }
            return colors;
        }
    }
}
