using GLTFast;
using GLTFast.Logging;
using GLTFast.Materials;
using GLTFast.Schema;
using UnityEngine;
using Material = UnityEngine.Material; // GLTFast.Schema also has a Material

namespace Runner.Loading
{
    /// <summary>
    /// Makes every glTF material from one flat-colour template material, tinted with the glTF base colour
    /// factor. glTFast's own shader graphs are large, have many variants, and rendered pink in WebGL builds.
    /// Textures, metalness and roughness are ignored on purpose: the platform's models are flat colours.
    /// </summary>
    public sealed class FlatMaterialGenerator : IMaterialGenerator
    {
        readonly Material template;

        public FlatMaterialGenerator(Material template)
        {
            this.template = template;
        }

        public Material GetDefaultMaterial(bool pointsSupport = false) => new Material(template);

        public Material GenerateMaterial(MaterialBase gltfMaterial, IGltfReadable gltf, bool pointsSupport = false)
        {
            var material = new Material(template);
            var linear = gltfMaterial.PbrMetallicRoughness != null ? gltfMaterial.PbrMetallicRoughness.BaseColor : UnityEngine.Color.white;
            material.color = linear.gamma; // glTF colours are linear; a Color property takes the sRGB value
            return material;
        }

        public void SetLogger(ICodeLogger logger) { }
    }
}
