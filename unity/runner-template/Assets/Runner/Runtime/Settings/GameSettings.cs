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
