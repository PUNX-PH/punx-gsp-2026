using UnityEngine;

namespace Runner.View
{
    /// <summary>Score, game-over panel, fps and errors, drawn with IMGUI so it needs no assets.</summary>
    public sealed class Hud : MonoBehaviour
    {
        public bool Loading = true;
        public string ErrorMessage;
        public int Score;
        public bool GameOver;
        public bool ShowFps;
        public int QualityLevel; // shown beside the fps with debug=1
        public string Subtitle; // a line under the score (an engine game shows its lives here); none when null
        public string EndText = "Game over\nTap to restart"; // what the end panel says
        public Color PanelColor = new Color(0.2f, 0.2f, 0.3f);
        public Color PanelTextColor = Color.white;
        public Color ScoreColor = Color.white;

        static readonly Color ErrorBackground = new Color(0.48f, 0.12f, 0.12f);
        static readonly Color LoadingBackground = new Color(0.1f, 0.1f, 0.15f);

        GUIStyle style;
        float fps = 60f;
        int shownScore = -1;
        string scoreText = "0";

        void Update()
        {
            if (ShowFps && Time.unscaledDeltaTime > 0f) fps = Mathf.Lerp(fps, 1f / Time.unscaledDeltaTime, 0.05f);
        }

        void OnGUI()
        {
            if (style == null) style = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, wordWrap = true };
            style.fontSize = Mathf.Max(14, Screen.height / 20);
            var screen = new Rect(0f, 0f, Screen.width, Screen.height);

            if (ErrorMessage != null)
            {
                Fill(screen, ErrorBackground);
                Label(new Rect(screen.width * 0.05f, 0f, screen.width * 0.9f, screen.height), ErrorMessage, Color.white);
                return;
            }
            if (Loading)
            {
                Fill(screen, LoadingBackground);
                Label(screen, "Loading", Color.white);
                return;
            }

            if (Score != shownScore)
            {
                shownScore = Score;
                scoreText = Score.ToString();
            }
            Label(new Rect(0f, screen.height * 0.03f, screen.width, screen.height * 0.12f), scoreText, ScoreColor);

            if (!string.IsNullOrEmpty(Subtitle)) Label(new Rect(0f, screen.height * 0.13f, screen.width, screen.height * 0.08f), Subtitle, ScoreColor);

            if (GameOver)
            {
                var panel = new Rect(screen.width * 0.15f, screen.height * 0.35f, screen.width * 0.7f, screen.height * 0.3f);
                Fill(panel, PanelColor);
                Label(panel, EndText, PanelTextColor);
            }
            if (ShowFps) Label(new Rect(0f, screen.height * 0.9f, screen.width * 0.3f, screen.height * 0.1f), fps.ToString("0") + " fps, quality " + QualityLevel, ScoreColor);
        }

        static void Fill(Rect rect, Color color)
        {
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = Color.white;
        }

        void Label(Rect rect, string text, Color color)
        {
            style.normal.textColor = color;
            GUI.Label(rect, text, style);
        }
    }
}
