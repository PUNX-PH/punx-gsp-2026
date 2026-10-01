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
