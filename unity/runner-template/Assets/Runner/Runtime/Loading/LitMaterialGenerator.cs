using GLTFast;
using GLTFast.Logging;
using GLTFast.Materials;
using GLTFast.Schema;
using UnityEngine;
using Material = UnityEngine.Material; // GLTFast.Schema also has a Material

namespace Runner.Loading
{
    /// <summary>
    /// Makes every glTF material from one lit template material (Runner/Lit), copying the glTF base color, metallic and roughness factors and
    /// the emissive factor. Textures are ignored on purpose, as in the flat look. Instancing is on, so the pooled clones of a model (they share
    /// its materials) are drawn in one call each.
    /// </summary>
    public sealed class LitMaterialGenerator : IMaterialGenerator
    {
        readonly Material template;

        public LitMaterialGenerator(Material template)
        {
            this.template = template;
        }

        public Material GetDefaultMaterial(bool pointsSupport = false) => Instance();

        public Material GenerateMaterial(MaterialBase gltfMaterial, IGltfReadable gltf, bool pointsSupport = false)
        {
            var material = Instance();
            var pbr = gltfMaterial.PbrMetallicRoughness;
            var linear = pbr != null ? pbr.BaseColor : UnityEngine.Color.white;
            material.SetColor("_BaseColor", linear.gamma); // glTF colors are linear; a Color property takes the sRGB value
            material.SetFloat("_Metallic", pbr != null ? Mathf.Clamp01(pbr.metallicFactor) : 0f);
            material.SetFloat("_Smoothness", pbr != null ? 1f - Mathf.Clamp01(pbr.roughnessFactor) : 0.5f);
            material.SetColor("_EmissionColor", gltfMaterial.Emissive); // an [HDR] property takes the linear value as it is
            return material;
        }

        public void SetLogger(ICodeLogger logger) { }

        Material Instance()
        {
            return new Material(template) { enableInstancing = true };
        }
    }
}
