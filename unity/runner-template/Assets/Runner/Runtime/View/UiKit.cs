using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// The few shapes the in-game interface is drawn from, made in code (no assets): a rounded rectangle that keeps its corners at any size, and text with a soft shadow so it
    /// reads over any ground or sky. Used by the HUD and by the script's own text and bars.
    /// </summary>
    public static class UiKit
    {
        const int Size = 64;
        const float Radius = 22f;
        static GUIStyle rounded;

        /// <summary>A white rounded rectangle, tinted by GUI.color, whose corners stay round when it is stretched.</summary>
        public static GUIStyle Rounded
        {
            get
            {
                if (rounded != null && rounded.normal.background != null) return rounded;
                var texture = new Texture2D(Size, Size, TextureFormat.RGBA32, false) { hideFlags = HideFlags.HideAndDontSave, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp };
                var pixels = new Color32[Size * Size];
                for (var y = 0; y < Size; y++)
                {
                    for (var x = 0; x < Size; x++)
                    {
                        // distance outside the rounded rectangle's inner box, in pixels: one pixel of anti-aliasing at the edge
                        var dx = Mathf.Max(Radius - 0.5f - x, x - (Size - 1 - Radius + 0.5f), 0f);
                        var dy = Mathf.Max(Radius - 0.5f - y, y - (Size - 1 - Radius + 0.5f), 0f);
                        var edge = Radius - Mathf.Sqrt(dx * dx + dy * dy);
                        pixels[y * Size + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(Mathf.Clamp01(edge + 0.5f) * 255f));
                    }
                }
                texture.SetPixels32(pixels);
                texture.Apply(false, true);
                rounded = new GUIStyle { border = new RectOffset((int)Radius, (int)Radius, (int)Radius, (int)Radius) };
                rounded.normal.background = texture;
                return rounded;
            }
        }

        /// <summary>Draws a rounded rectangle of this color; the corner size follows the height, so a thin bar is a capsule.</summary>
        public static void Box(Rect rect, Color color)
        {
            var old = GUI.color;
            GUI.color = color;
            // The style's border is in texture pixels and is scaled with the rect, so a small rect keeps proportionally round corners.
            Rounded.Draw(rect, GUIContent.none, false, false, false, false);
            GUI.color = old;
        }

        /// <summary>Text with a one-step dark shadow under it; the style's own color is the text color.</summary>
        public static void Label(Rect rect, string text, GUIStyle style, float shadow = 0f)
        {
            var color = style.normal.textColor;
            var offset = shadow > 0f ? shadow : Mathf.Max(1f, style.fontSize * 0.06f);
            style.normal.textColor = new Color(0f, 0f, 0f, 0.55f * color.a);
            GUI.Label(new Rect(rect.x + offset, rect.y + offset, rect.width, rect.height), text, style);
            style.normal.textColor = color;
            GUI.Label(rect, text, style);
        }
    }
}
