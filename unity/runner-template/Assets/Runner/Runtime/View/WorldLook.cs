using System;
using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// The numbers the lit and the sky shaders read, as plain vectors (no color space conversion happens to them): the sun, the sky, the ambient
    /// light, the fog and the exposure. Each style of world has a table; the palette picks of the environment (the sky and the field) tint it, so a
    /// palette change changes the world. Pure but for the shader globals, which only <see cref="Apply"/> sets.
    /// </summary>
    public readonly struct WorldLook
    {
        public static readonly string[] Styles = { "desert", "meadow" };

        public readonly Vector4 SunDir;     // toward the light, in the lit shader
        public readonly Vector4 SunColor;
        public readonly Vector4 SkyTop;
        public readonly Vector4 SkyHorizon;
        public readonly Vector4 AmbSky;
        public readonly Vector4 AmbGround;
        public readonly Vector4 FogColor;
        public readonly Vector4 FogParams;  // x start, y end, z exposure
        public readonly Vector4 SkySunDir;  // where the visible sun sits in the sky

        WorldLook(Vector4 sunDir, Vector4 sunColor, Vector4 skyTop, Vector4 skyHorizon, Vector4 ambSky, Vector4 ambGround, Vector4 fogColor, Vector4 fogParams, Vector4 skySunDir)
        {
            SunDir = sunDir;
            SunColor = sunColor;
            SkyTop = skyTop;
            SkyHorizon = skyHorizon;
            AmbSky = ambSky;
            AmbGround = ambGround;
            FogColor = fogColor;
            FogParams = fogParams;
            SkySunDir = skySunDir;
        }

        /// <summary>The look of a style of world (an unknown style is the meadow), tinted by the environment's sky and field colors.</summary>
        public static WorldLook For(string style, Color sky, Color field)
        {
            // the desert at sunset, and the meadow in daylight
            var desert = string.Equals(style, "desert", StringComparison.Ordinal);
            var sunDir = desert ? new Vector4(-0.45f, 0.55f, -0.35f, 0f) : new Vector4(-0.40f, 0.80f, -0.35f, 0f);
            var sunColor = desert ? new Vector4(1.15f, 0.80f, 0.52f, 1f) : new Vector4(1.05f, 0.97f, 0.85f, 1f);
            var skyTop = desert ? new Vector4(0.015f, 0.010f, 0.070f, 1f) : new Vector4(0.18f, 0.36f, 0.72f, 1f);
            var skyHorizon = desert ? new Vector4(0.95f, 0.26f, 0.10f, 1f) : new Vector4(0.62f, 0.78f, 0.92f, 1f);
            var ambSky = desert ? new Vector4(0.13f, 0.11f, 0.24f, 1f) : new Vector4(0.35f, 0.42f, 0.55f, 1f);
            var ambGround = desert ? new Vector4(0.12f, 0.06f, 0.045f, 1f) : new Vector4(0.18f, 0.20f, 0.14f, 1f);
            var fogColor = desert ? new Vector4(0.50f, 0.17f, 0.11f, 1f) : new Vector4(0.62f, 0.74f, 0.86f, 1f);
            var fogParams = desert ? new Vector4(32f, 140f, 0.82f, 0f) : new Vector4(40f, 140f, 0.95f, 0f);
            var skySunDir = desert ? new Vector4(0.22f, 0.06f, 0.97f, 0f) : new Vector4(0.25f, 0.45f, 0.85f, 0f);

            // The palette pulls the table toward its own colors, so that a game painted in another palette looks like its own world.
            return new WorldLook(
                sunDir,
                sunColor,
                Mix(skyTop, Scaled(sky, 0.45f), 0.55f),
                Mix(skyHorizon, Scaled(sky, 1f), 0.30f),
                Mix(ambSky, Scaled(sky, 0.60f), 0.35f),
                Mix(ambGround, Scaled(field, 0.45f), 0.45f),
                Mix(fogColor, Scaled(sky, 1f), 0.25f),
                fogParams,
                skySunDir);
        }

        static Vector4 Scaled(Color c, float scale) => new Vector4(c.r * scale, c.g * scale, c.b * scale, 1f);

        // a toward b by t, keeping the alpha of a
        static Vector4 Mix(Vector4 a, Vector4 b, float t)
        {
            return new Vector4(Mathf.Lerp(a.x, b.x, t), Mathf.Lerp(a.y, b.y, t), Mathf.Lerp(a.z, b.z, t), a.w);
        }

        /// <summary>Sets the shader globals the lit shader and the sky read.</summary>
        public void Apply()
        {
            Shader.SetGlobalVector("_SunDir", SunDir);
            Shader.SetGlobalVector("_SunColor", SunColor);
            Shader.SetGlobalVector("_SkyTop", SkyTop);
            Shader.SetGlobalVector("_SkyHorizon", SkyHorizon);
            Shader.SetGlobalVector("_AmbSky", AmbSky);
            Shader.SetGlobalVector("_AmbGround", AmbGround);
            Shader.SetGlobalVector("_FogColor", FogColor);
            Shader.SetGlobalVector("_FogParams", FogParams);
            Shader.SetGlobalVector("_SkySunDir", SkySunDir);
            SetSimple(false);
        }

        /// <summary>The simple look (the quality governor's last level): the lit shader keeps only wrapped diffuse, ambient and fog.</summary>
        public static void SetSimple(bool simple)
        {
            Shader.SetGlobalFloat("_Simple", simple ? 1f : 0f);
        }
    }
}
