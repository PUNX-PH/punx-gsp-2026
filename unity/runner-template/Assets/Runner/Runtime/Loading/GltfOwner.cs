using GLTFast;
using UnityEngine;

namespace Runner.Loading
{
    /// <summary>Keeps a glTFast import alive while the model made from it exists, then disposes it.</summary>
    public sealed class GltfOwner : MonoBehaviour
    {
        public GltfImport Import;

        void OnDestroy()
        {
            Import?.Dispose();
        }
    }
}
