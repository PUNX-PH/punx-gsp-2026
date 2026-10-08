using UnityEngine;

namespace Runner.Scripting
{
    /// <summary>The script's own text and bars over the scene, drawn with IMGUI like the runner's HUD. The score line, the end panel and the error screen are the HUD's.</summary>
    public sealed class ScriptHud : MonoBehaviour
    {
        public ScriptView View;

        GUIStyle style;

        void OnGUI()
        {
            if (View == null || View.Failed || View.Runner == null) return;
            if (style == null) style = new GUIStyle(GUI.skin.label) { wordWrap = false, clipping = TextClipping.Overflow };
            var width = (float)Screen.width;
            var height = (float)Screen.height;
            foreach (var e in View.Runner.Api.Ui)
            {
                var color = View.ColorOf(e.Color, Color.white);
                if (e.IsBar)
                {
                    var rect = new Rect((float)e.X * width, (float)e.Y * height, (float)e.W * width, (float)e.H * height);
                    Fill(rect, new Color(0f, 0f, 0f, 0.5f));
                    var fraction = e.Max > 0 ? Mathf.Clamp01((float)(e.Value / e.Max)) : 0f;
                    Fill(new Rect(rect.x, rect.y, rect.width * fraction, rect.height), color);
                    continue;
                }
                style.fontSize = Mathf.Max(10, Mathf.RoundToInt((float)e.Size * height));
                style.normal.textColor = color;
                var lineHeight = style.fontSize * 1.6f;
                var x = (float)e.X * width;
                var y = (float)e.Y * height;
                switch (e.Align)
                {
                    case "center":
                        style.alignment = TextAnchor.UpperCenter;
                        GUI.Label(new Rect(x - width / 2f, y, width, lineHeight), e.Text, style);
                        break;
                    case "right":
                        style.alignment = TextAnchor.UpperRight;
                        GUI.Label(new Rect(x - width, y, width, lineHeight), e.Text, style);
                        break;
                    default:
                        style.alignment = TextAnchor.UpperLeft;
                        GUI.Label(new Rect(x, y, width, lineHeight), e.Text, style);
                        break;
                }
            }
        }

        static void Fill(Rect rect, Color color)
        {
            GUI.color = color;
            GUI.DrawTexture(rect, Texture2D.whiteTexture);
            GUI.color = Color.white;
        }
    }
}
