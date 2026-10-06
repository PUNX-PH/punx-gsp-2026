// A gradient sky with a sun disc, glow, cloud bands and stars, drawn on a big inverted sphere that follows the camera. Its colors are the
// same global vectors the lit shader reads (WorldLook sets them).
Shader "Runner/Sky"
{
    SubShader
    {
        Tags { "Queue" = "Background" "RenderType" = "Background" }
        Cull Front
        ZWrite Off

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            half4 _SkyTop;
            half4 _SkyHorizon;
            half4 _SunColor;
            half4 _FogColor;
            float4 _SkySunDir;    // where the visible sun sits

            struct v2f
            {
                float4 pos : SV_POSITION;
                float3 dir : TEXCOORD0;
            };

            v2f vert(float4 vertex : POSITION)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(vertex);
                o.dir = vertex.xyz;
                return o;
            }

            float hash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float3 d = normalize(i.dir);
                float h = d.y;
                half3 col = lerp(_SkyHorizon.rgb, _SkyTop.rgb, pow(saturate(h), 0.55));
                col = lerp(col, _FogColor.rgb, smoothstep(0.0, -0.25, h)); // below the horizon blends into the fog color

                float sd = saturate(dot(d, normalize(_SkySunDir.xyz)));
                float disc = smoothstep(0.99935, 0.99975, sd);
                float glow = pow(sd, 90.0) * 0.55 + pow(sd, 8.0) * 0.28;
                col += _SunColor.rgb * (disc * 5.0 + glow);

                // thin cloud bands near the horizon, lit from below
                float band = smoothstep(0.02, 0.10, h) * smoothstep(0.34, 0.12, h);
                float streak = 0.5 + 0.5 * sin(d.x * 24.0 + sin(h * 70.0) * 2.5 + h * 40.0);
                col += _SunColor.rgb * band * pow(streak, 3.0) * 0.18 * (0.4 + sd);

                // stars in the dark part of the sky
                float2 p = d.xz / (h + 1.3) * 210.0;
                float s = step(0.9972, hash21(floor(p)));
                col += s * smoothstep(0.12, 0.5, h) * (1.0 - saturate(glow * 2.5)) * 0.9;
                return fixed4(col, 1);
            }
            ENDCG
        }
    }
}
