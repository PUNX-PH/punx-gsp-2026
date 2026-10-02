using System;
using System.Threading.Tasks;
using GLTFast;
using GLTFast.Materials;
using UnityEngine;
using UnityEngine.Networking;
using Object = UnityEngine.Object;

namespace Runner.Loading
{
    public sealed class LoadException : Exception
    {
        public LoadException(string message) : base(message) { }
    }

    public static class AssetLoader
    {
        // Web builds have no threads or timers, so the time limit is counted once per frame (see FrameTimeout).
        const float TimeoutSeconds = 30f;

        public static async Task<string> FetchText(string url)
        {
            try
            {
                using (var request = UnityWebRequest.Get(url))
                {
                    var operation = request.SendWebRequest();
                    var timeout = new FrameTimeout(TimeoutSeconds);
                    while (!operation.isDone)
                    {
                        if (timeout.Tick(Time.unscaledDeltaTime))
                        {
                            request.Abort();
                            throw new LoadException("timed out after " + TimeoutSeconds + " s");
                        }
                        await Task.Yield();
                    }
                    if (request.result != UnityWebRequest.Result.Success) throw new LoadException(Describe(request));
                    return request.downloadHandler.text;
                }
            }
            catch (Exception e) when (!(e is LoadException))
            {
                throw new LoadException(e.Message);
            }
        }

        /// <summary>
        /// Loads a GLB and instantiates it. The returned object is a child of a "Model" object under parent;
        /// that parent owns the glTFast import and disposes it when destroyed, so clone the returned object
        /// (not its parent) to make copies.
        /// </summary>
        public static async Task<GameObject> LoadModel(string url, Transform parent, IMaterialGenerator materialGenerator = null)
        {
            var import = new GltfImport(materialGenerator: materialGenerator);
            GameObject owner = null;
            try
            {
                var load = import.Load(url);
                var timeout = new FrameTimeout(TimeoutSeconds);
                while (!load.IsCompleted)
                {
                    if (timeout.Tick(Time.unscaledDeltaTime))
                        throw new LoadException("timed out after " + TimeoutSeconds + " s");
                    await Task.Yield();
                }
                if (!await load) throw new LoadException("is not a valid GLB file");

                owner = new GameObject("Model");
                owner.transform.SetParent(parent, false);
                var content = new GameObject("Content");
                content.transform.SetParent(owner.transform, false);
                if (!await import.InstantiateMainSceneAsync(content.transform))
                    throw new LoadException("has no scene to show");

                owner.AddComponent<GltfOwner>().Import = import;
                return content;
            }
            catch (Exception e)
            {
                if (owner != null) Object.Destroy(owner);
                import.Dispose();
                if (e is LoadException) throw;
                throw new LoadException(e.Message);
            }
        }

        static string Describe(UnityWebRequest request)
        {
            if (request.responseCode >= 400) return "HTTP " + request.responseCode;
            return string.IsNullOrEmpty(request.error) ? "request failed" : request.error;
        }
    }
}
