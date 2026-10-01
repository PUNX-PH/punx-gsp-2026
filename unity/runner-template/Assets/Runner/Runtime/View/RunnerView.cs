using System.Collections.Generic;
using Runner.Sim;
using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// Draws a RunnerSim: a camera, light and ground built from code, the hero, and recycled obstacle and
    /// collectible instances cloned from the loaded models.
    /// </summary>
    public sealed class RunnerView
    {
        const float CollectibleLift = 0.3f;

        readonly Transform hero;
        readonly Transform ground;
        readonly Transform cameraTransform;
        readonly List<Transform> obstacles = new List<Transform>();
        readonly List<Transform> collectibles = new List<Transform>();

        /// <param name="poolSize">How many obstacles, and how many collectibles, can be on screen at once.</param>
        public RunnerView(Transform root, GameObject heroModel, GameObject obstacleModel, GameObject collectibleModel,
                          Color background, Color groundColor, int poolSize)
        {
            var cameraObject = new GameObject("Camera") { tag = "MainCamera" };
            cameraObject.transform.SetParent(root, false);
            var camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = background;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 150f;
            cameraTransform = cameraObject.transform;

            var lightObject = new GameObject("Light");
            lightObject.transform.SetParent(root, false);
            lightObject.AddComponent<Light>().type = LightType.Directional;
            lightObject.transform.rotation = Quaternion.Euler(50f, -30f, 0f);

            var groundObject = GameObject.CreatePrimitive(PrimitiveType.Cube);
            groundObject.name = "Ground";
            Object.Destroy(groundObject.GetComponent<Collider>());
            groundObject.transform.SetParent(root, false);
            groundObject.transform.localScale = new Vector3(8f, 0.2f, 400f);
            groundObject.GetComponent<Renderer>().material.color = groundColor;
            ground = groundObject.transform;

            hero = Wrap("Hero", heroModel, root);
            for (var i = 0; i < poolSize; i++)
            {
                obstacles.Add(Wrap("Obstacle", obstacleModel, root));
                collectibles.Add(Wrap("Collectible", collectibleModel, root));
            }
        }

        public void Sync(RunnerSim sim)
        {
            hero.localPosition = new Vector3(0f, sim.HeroY, sim.Z);
            ground.localPosition = new Vector3(0f, -0.1f, sim.Z + 100f);
            cameraTransform.localPosition = new Vector3(0f, 3f, sim.Z - 7f);
            cameraTransform.LookAt(new Vector3(0f, 1f, sim.Z + 5f));

            int obstacleCount = 0, collectibleCount = 0;
            var entities = sim.Entities;
            for (var i = 0; i < entities.Count; i++) // indexed loop: no enumerator allocation per frame
            {
                var e = entities[i];
                if (!e.Active) continue;
                if (e.Kind == EntityKind.Obstacle) Place(obstacles, ref obstacleCount, e.Z, 0f);
                else Place(collectibles, ref collectibleCount, e.Z, CollectibleLift);
            }
            HideFrom(obstacles, obstacleCount);
            HideFrom(collectibles, collectibleCount);
        }

        // A wrapper is what gets moved; the clone inside keeps the scale and offset ModelFit gave the prototype.
        static Transform Wrap(string name, GameObject model, Transform root)
        {
            var wrapper = new GameObject(name).transform;
            wrapper.SetParent(root, false);
            Object.Instantiate(model, wrapper).SetActive(true);
            return wrapper;
        }

        static void Place(List<Transform> pool, ref int used, float z, float y)
        {
            if (used >= pool.Count) return;
            var item = pool[used++];
            if (!item.gameObject.activeSelf) item.gameObject.SetActive(true);
            item.localPosition = new Vector3(0f, y, z);
        }

        static void HideFrom(List<Transform> pool, int firstUnused)
        {
            for (var i = firstUnused; i < pool.Count; i++)
                if (pool[i].gameObject.activeSelf) pool[i].gameObject.SetActive(false);
        }
    }
}
