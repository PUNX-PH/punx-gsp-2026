// One flat-colour shader for everything in the runner template: the ground and every model glTFast loads.
// Built-in render pipeline, one pass, no keywords (so there are no shader variants to strip), and a fixed
// half-Lambert shade from the main directional light. Hypercasual art is flat colours; this is all it needs,
// and it keeps the WebGL build small and quick to start.
Shader "Runner/Flat"
{
    Properties
    {
        [MainColor] _BaseColor ("Color", Color) = (1, 1, 1, 1)
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
            #include "UnityCG.cginc"

            fixed4 _BaseColor;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                half3 normalWS : TEXCOORD0;
            };

            v2f vert(appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.normalWS = UnityObjectToWorldNormal(v.normal);
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                half3 normal = normalize(i.normalWS);
                half shade = saturate(dot(normal, normalize(_WorldSpaceLightPos0.xyz))) * 0.6 + 0.4;
                return fixed4(_BaseColor.rgb * shade, 1);
            }
            ENDCG
        }
    }
}
