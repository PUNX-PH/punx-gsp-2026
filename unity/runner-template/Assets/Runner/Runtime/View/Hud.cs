using UnityEngine;

namespace Runner.View
{
    /// <summary>Score, game-over panel, loading screen, fps and errors, drawn with IMGUI so it needs no assets (the rounded shapes are made in code, see <see cref="UiKit"/>).</summary>
    public sealed class Hud : MonoBehaviour
    {
        public bool Loading = true;
        public string ErrorMessage;
        public int Score;
        public bool GameOver;
        public bool ShowFps;
        public int QualityLevel; // shown beside the fps with debug=1
        public string Subtitle; // a line under the score (an engine game shows its lives here); none when null
        public string EndText = "Game over\nTap to restart"; // what the end panel says: a title, then optional lines, the last of which may be the hint to play again
        public Color PanelColor = new Color(0.2f, 0.2f, 0.3f);
        public Color PanelTextColor = Color.white;
        public Color ScoreColor = Color.white;

        // IMGUI colors are read as linear in this project: the page's #0e1016 and the error red are given in sRGB and converted, so the loading screen is the page's own color
        static readonly Color ErrorBackground = new Color(0.1f, 0.06f, 0.07f).linear;
        static readonly Color LoadingBackground = new Color(0.055f, 0.063f, 0.086f).linear; // the page around the game is the same color, so nothing flashes
        static readonly Color Pill = new Color(0f, 0f, 0f, 0.42f);

        GUIStyle style;
        float fps = 60f;
        int shownScore = -1;
        string scoreText = "0";

        void Update()
        {
            if (ShowFps && Time.unscaledDeltaTime > 0f) fps = Mathf.Lerp(fps, 1f / Time.unscaledDeltaTime, 0.05f);
        }

        /// <summary>One unit of the interface: a hundredth of the height, but no more than 1.5 hundredths of the width, so a tall narrow frame (a phone held upright, a panel beside the editor) gets smaller text, not text wider than the screen.</summary>
        public static float UnitFor(float width, float height) => Mathf.Max(8f, Mathf.Min(height, width * 1.5f) / 100f);

        void OnGUI()
        {
            if (style == null) style = new GUIStyle(GUI.skin.label) { alignment = TextAnchor.MiddleCenter, wordWrap = true, fontStyle = FontStyle.Bold };
            var screen = new Rect(0f, 0f, Screen.width, Screen.height);
            var unit = UnitFor(Screen.width, Screen.height); // sizes and gaps are in these, so the interface scales with the screen

            if (ErrorMessage != null)
            {
                Fill(screen, ErrorBackground);
                Text(new Rect(screen.width * 0.08f, 0f, screen.width * 0.84f, screen.height), ErrorMessage, 3.2f * unit, new Color(1f, 0.82f, 0.8f), FontStyle.Normal);
                return;
            }
            if (Loading)
            {
                Fill(screen, LoadingBackground);
                var dots = new string('.', 1 + (int)(Time.realtimeSinceStartup * 2.5f) % 3);
                Text(new Rect(0f, 0f, screen.width, screen.height), "Making your game" + dots, 2.8f * unit, new Color(0.78f, 0.8f, 0.86f), FontStyle.Normal);
                return;
            }

            if (Score != shownScore)
            {
                shownScore = Score;
                scoreText = Score.ToString();
            }

            // the score: a small pill at the top middle
            var scoreSize = 4.4f * unit;
            style.fontSize = Mathf.RoundToInt(scoreSize);
            var scoreWidth = Mathf.Max(scoreSize * 2.6f, style.CalcSize(new GUIContent(scoreText)).x + scoreSize * 1.6f);
            var scoreRect = new Rect((screen.width - scoreWidth) / 2f, unit * 2f, scoreWidth, scoreSize * 1.7f);
            UiKit.Box(scoreRect, Pill);
            Label(scoreRect, scoreText, ScoreColor);

            if (!string.IsNullOrEmpty(Subtitle)) Text(new Rect(0f, scoreRect.yMax + unit * 0.5f, screen.width, 3.4f * unit * 1.6f), Subtitle, 3.2f * unit, ScoreColor, FontStyle.Normal);

            if (GameOver) DrawEnd(screen, unit);
            if (ShowFps) Text(new Rect(unit, screen.height - 5f * unit, screen.width * 0.4f, 4f * unit), fps.ToString("0") + " fps, quality " + QualityLevel, 2.6f * unit, ScoreColor, FontStyle.Normal, TextAnchor.MiddleLeft);
        }

        // Dim the scene, then a rounded panel with the outcome large, a line of detail, and the hint to play again quiet at the bottom.
        void DrawEnd(Rect screen, float unit)
        {
            Fill(screen, new Color(0f, 0f, 0f, 0.5f));
            var lines = (EndText ?? "").Split('\n');
            var title = lines.Length > 0 ? lines[0] : "";
            var hint = lines.Length > 1 && lines[lines.Length - 1].StartsWith("Tap") ? lines[lines.Length - 1] : "";
            var detail = lines.Length > 2 || (lines.Length == 2 && hint == "") ? string.Join("\n", lines, 1, lines.Length - 1 - (hint == "" ? 0 : 1)) : "";

            var width = Mathf.Min(screen.width * 0.88f, unit * 52f);
            var height = unit * (hint == "" ? 20f : 24f) + (detail == "" ? 0f : unit * 4f);
            var panel = new Rect((screen.width - width) / 2f, (screen.height - height) / 2f, width, height);
            UiKit.Box(new Rect(panel.x, panel.y + unit * 0.8f, panel.width, panel.height), new Color(0f, 0f, 0f, 0.28f)); // a soft drop shadow
            UiKit.Box(panel, PanelColor);

            var y = panel.y + unit * 2.4f;
            Text(new Rect(panel.x + unit * 2f, y, panel.width - unit * 4f, unit * 9f), title, 6.4f * unit, PanelTextColor, FontStyle.Bold, TextAnchor.MiddleCenter, false, true);
            y += unit * 9.5f;
            if (detail != "")
            {
                Text(new Rect(panel.x + unit * 2f, y, panel.width - unit * 4f, unit * 6f), detail, 3.2f * unit, new Color(PanelTextColor.r, PanelTextColor.g, PanelTextColor.b, 0.9f), FontStyle.Normal, TextAnchor.MiddleCenter, false);
                y += unit * 6.5f;
            }
            if (hint != "") Text(new Rect(panel.x, panel.yMax - unit * 7.5f, panel.width, unit * 5f), hint, 2.8f * unit, new Color(PanelTextColor.r, PanelTextColor.g, PanelTextColor.b, 0.7f), FontStyle.Normal, TextAnchor.MiddleCenter, false);
        }

        static void Fill(Rect rect, Color color)
        {
            var old = GUI.color;
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = old;
        }

        void Text(Rect rect, string text, float size, Color color, FontStyle fontStyle, TextAnchor anchor = TextAnchor.MiddleCenter, bool shadow = true, bool fit = false)
        {
            style.fontSize = Mathf.Max(10, Mathf.RoundToInt(size));
            style.fontStyle = fontStyle;
            if (fit)
            {
                // one line, made smaller until it fits the width it was given
                style.wordWrap = false;
                var content = new GUIContent(text);
                for (var i = 0; i < 16 && style.fontSize > 10 && style.CalcSize(content).x > rect.width; i++) style.fontSize = Mathf.Max(10, Mathf.FloorToInt(style.fontSize * 0.92f));
            }
            style.alignment = anchor;
            style.normal.textColor = color;
            if (shadow) UiKit.Label(rect, text, style);
            else GUI.Label(rect, text, style);
            style.fontStyle = FontStyle.Bold;
            style.alignment = TextAnchor.MiddleCenter;
            style.wordWrap = true;
        }

        void Label(Rect rect, string text, Color color)
        {
            style.alignment = TextAnchor.MiddleCenter;
            style.normal.textColor = color;
            UiKit.Label(rect, text, style);
        }
    }
}
