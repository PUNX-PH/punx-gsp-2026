// The lit look of a High game. Built-in render pipeline, one ForwardBase pass, and no keywords except instancing (so there are two variants,
// not hundreds). Wrapped sun diffuse, hemisphere ambient, GGX sun specular, a cheap sky reflection for metals, rim light, emission, the
// baked occlusion in the vertex colors, an ACES-style tone curve and distance fog. The world's values come from global vectors that
// WorldLook sets (plain numbers, so no color space conversion happens to them).
//
// _Simple is a global too: 1 on a slow device (the last level of the quality governor), which keeps only wrapped diffuse, ambient and fog.
Shader "Runner/Lit"
{
    Properties
    {
        [MainColor] _BaseColor ("Color", Color) = (1, 1, 1, 1)
        _Metallic ("Metallic", Range(0, 1)) = 0
        _Smoothness ("Smoothness", Range(0, 1)) = 0.5
        [HDR] _EmissionColor ("Emission", Color) = (0, 0, 0, 1)
        _Mottle ("Ground mottle", Range(0, 1)) = 0
    }

    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" }

        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "UnityCG.cginc"

            fixed4 _BaseColor;
            half _Metallic;
            half _Smoothness;
            half4 _EmissionColor;
            half _Mottle;         // > 0 on the ground: patches of lighter and darker color by world position, so a field is not one flat color

            float4 _SunDir;       // direction TOWARD the light (lighting)
            half4 _SunColor;
            half4 _SkyTop;
            half4 _SkyHorizon;
            half4 _AmbSky;
            half4 _AmbGround;
            half4 _FogColor;
            float4 _FogParams;    // x start, y end, z exposure
            float _Simple;        // 1: wrapped diffuse, ambient and fog only

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                fixed4 color : COLOR;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                half3 nws : TEXCOORD0;
                float3 wpos : TEXCOORD1;
                fixed4 col : COLOR;
            };

            v2f vert(appdata v)
            {
                UNITY_SETUP_INSTANCE_ID(v);
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.nws = UnityObjectToWorldNormal(v.normal);
                o.wpos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.col = v.color;
                return o;
            }

            float hash21(float2 p)
            {
                p = frac(p * float2(123.34, 456.21));
                p += dot(p, p + 45.32);
                return frac(p.x * p.y);
            }

            float valueNoise(float2 p)
            {
                float2 c = floor(p);
                float2 f = frac(p);
                f = f * f * (3.0 - 2.0 * f);
                return lerp(lerp(hash21(c), hash21(c + float2(1, 0)), f.x), lerp(hash21(c + float2(0, 1)), hash21(c + float2(1, 1)), f.x), f.y);
            }

            half3 aces(half3 x)
            {
                const half a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
                return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
            }

            half3 withFog(half3 col, float dist)
            {
                half fog = saturate((dist - _FogParams.x) / max(_FogParams.y - _FogParams.x, 1.0));
                fog = fog * fog * (3.0 - 2.0 * fog);
                return lerp(col, _FogColor.rgb, fog);
            }

            fixed4 frag(v2f i) : SV_Target
            {
                half3 N = normalize(i.nws);
                float3 toCam = _WorldSpaceCameraPos - i.wpos;
                float dist = length(toCam);
                half3 L = normalize(_SunDir.xyz);

                half3 albedo = _BaseColor.rgb * i.col.rgb;
                if (_Mottle > 0.0)
                    albedo *= 1.0 + _Mottle * ((valueNoise(i.wpos.xz * 0.30) - 0.5) + 0.5 * (valueNoise(i.wpos.xz * 1.30) - 0.5));
                half metallic = _Metallic;
                half smooth = _Smoothness;

                half ndl = dot(N, L);
                half diff = saturate((ndl + 0.25) / 1.25);
                half3 hemi = lerp(_AmbGround.rgb, _AmbSky.rgb, N.y * 0.5 + 0.5) * i.col.rgb;
                half3 diffuseCol = albedo * (1.0 - metallic);

                // the simple look: no specular, no reflection, no rim
                if (_Simple > 0.5)
                {
                    half3 simple = diffuseCol * (hemi + _SunColor.rgb * diff * i.col.rgb) + _EmissionColor.rgb;
                    return fixed4(withFog(aces(simple * _FogParams.z), dist), 1);
                }

                half3 V = toCam / max(dist, 1e-4);
                half rough = 1.0 - smooth;
                half3 f0 = lerp(half3(0.04, 0.04, 0.04), albedo, metallic);

                half3 H = normalize(L + V);
                half nh = saturate(dot(N, H));
                half vh = saturate(dot(V, H));
                half nv = saturate(dot(N, V));
                half a = max(rough * rough, 0.05);
                half a2 = a * a;
                half dd = nh * nh * (a2 - 1.0) + 1.0;
                half D = a2 / (3.14159 * dd * dd);
                half3 F = f0 + (1.0 - f0) * pow(1.0 - vh, 5.0);
                half3 sunSpec = F * min(D * 0.25 / max(0.3, vh * vh), 10.0) * saturate(ndl) * _SunColor.rgb;

                half3 R = reflect(-V, N);
                half3 sky = lerp(_SkyHorizon.rgb, _SkyTop.rgb, saturate(R.y));
                half3 envCol = lerp(_AmbGround.rgb * 1.3, sky, smoothstep(-0.12, 0.08, R.y));
                half3 Fe = f0 + (max(smooth, f0) - f0) * pow(1.0 - nv, 5.0);
                half3 envSpec = Fe * envCol * (0.2 + 0.8 * smooth) * i.col.rgb;

                half3 rim = pow(1.0 - nv, 3.0) * _SkyHorizon.rgb * (0.25 + 0.5 * smooth) * albedo;

                half3 col = diffuseCol * (hemi + _SunColor.rgb * diff * i.col.rgb) + sunSpec + envSpec + rim + _EmissionColor.rgb;
                return fixed4(withFog(aces(col * _FogParams.z), dist), 1);
            }
            ENDCG
        }
    }
}
