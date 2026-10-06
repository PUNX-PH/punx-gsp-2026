// A soft round contact shadow drawn on the ground under the hero.
Shader "Runner/BlobShadow"
{
    Properties { _Color ("Color", Color) = (0, 0, 0, 0.55) }

    SubShader
    {
        Tags { "Queue" = "Transparent-1" "RenderType" = "Transparent" }
        Blend SrcAlpha OneMinusSrcAlpha
        ZWrite Off
        Cull Off
        Offset -2, -2

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"

            fixed4 _Color;

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            v2f vert(float4 vertex : POSITION, float2 uv : TEXCOORD0)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(vertex);
                o.uv = uv;
                return o;
            }

            fixed4 frag(v2f i) : SV_Target
            {
                float r = length(i.uv - 0.5) * 2.0;
                float a = saturate(1.0 - r);
                a = a * a * (3.0 - 2.0 * a);
                return fixed4(_Color.rgb, a * _Color.a);
            }
            ENDCG
        }
    }
}
