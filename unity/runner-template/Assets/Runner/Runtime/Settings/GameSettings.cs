using System;

namespace Runner.Settings
{
    /// <summary>Settings schema v1. Public fields so JsonUtility can fill them.</summary>
    [Serializable]
    public class GameSettings
    {
        public int schemaVersion;
        public string template;
        public string[] palette;
        public Roles roles;
        public Tuning tuning;
        public EnvironmentSettings environment; // optional: JsonUtility leaves it empty when the file has none (see SettingsParser.HasEnvironment)
        // optional: "flat" (or absent) or "lit". Not read by JsonUtility, which cannot tell a look of the wrong type from none: SettingsParser reads it from the text.
        [NonSerialized] public string look;
    }

    /// <summary>Colors are indexes into the palette; the scenery files are GLBs next to settings.json.</summary>
    [Serializable]
    public class EnvironmentSettings
    {
        public int sky;
        public int field;
        public int stripe;
        public string density;
        public string[] scenery;
        // optional, High only; not read by JsonUtility either (SettingsParser fills it from the text, null when the file has none)
        [NonSerialized] public WorldSettings world;
    }

    /// <summary>The style of the High world ("desert" or "meadow"); its three files are terrain.glb, road.glb and backdrop.glb next to settings.json.</summary>
    public class WorldSettings
    {
        public string style;
    }

    [Serializable]
    public class Roles
    {
        public string hero;
        public string obstacle;
        public string collectible;
    }

    [Serializable]
    public class Tuning
    {
        public float speed;
        public float jumpHeight;
        public float obstacleSpacing;
    }
}
