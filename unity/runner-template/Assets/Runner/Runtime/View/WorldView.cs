using System.Collections.Generic;
using Runner.Loading;
using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// The High world around the track: a sky dome that follows the camera, copies of the terrain and the road tile that are moved by whole tiles as
    /// the hero runs, a ring of distant mesas or hills that follows the camera in x and z, and a soft shadow under the hero. The terrain, the road and
    /// the backdrop are the models loaded from the run (the clones share their meshes, so each is in memory once and drawn by instancing); the sky and
    /// the shadow are meshes made in code (not CreatePrimitive: this build's physics module is stripped, and a primitive needs its collider).
    /// The scenery is not here: EnvironmentView keeps it, as it does without a world.
    /// </summary>
    public sealed class WorldView
    {
        // The road's surface is built 0.02 m above the terrain's flat strip; both are lowered so that the road's top is at y = 0, where the hero stands.
        const float TerrainY = -0.04f;
        const float RoadY = -0.02f;
        const float ShadowY = 0.03f;
        const float SkyRadius = 140f; // inside the camera's far plane (150)

        readonly Transform sky;
        readonly Transform backdrop;
        readonly Transform shadow;
        readonly Material shadowMaterial;
        readonly List<Transform> terrain = new List<Transform>();
        readonly List<Transform> road = new List<Transform>();
        float placedBase = float.NaN; // the tile base the tiles stand at now, so they are only moved when it changes

        /// <param name="models">The hidden prototypes loaded from terrain.glb, road.glb and backdrop.glb.</param>
        public WorldView(Transform root, IReadOnlyDictionary<string, GameObject> models, WorldLook look)
        {
            look.Apply();

            var skyShader = Shader.Find("Runner/Sky");
            if (skyShader == null) throw new LoadException("the Runner/Sky shader is missing from this build");
            sky = MakeMeshObject("Sky", MakeSphere(28, 18), new Material(skyShader), root);
            sky.localScale = Vector3.one * SkyRadius;

            for (var i = 0; i < WorldPlacement.TileCount; i++)
            {
                terrain.Add(Clone("Terrain", models["terrain.glb"], root));
                road.Add(Clone("Road", models["road.glb"], root));
            }
            backdrop = Clone("Backdrop", models["backdrop.glb"], root);

            var shadowShader = Shader.Find("Runner/BlobShadow");
            if (shadowShader == null) throw new LoadException("the Runner/BlobShadow shader is missing from this build");
            shadowMaterial = new Material(shadowShader);
            shadow = MakeMeshObject("HeroShadow", MakeQuad(), shadowMaterial, root);
            shadow.rotation = Quaternion.Euler(90f, 0f, 0f);
            shadow.localScale = new Vector3(1.5f, 1.5f, 1f);
        }

        /// <summary>Every tile copy, the terrain's and then the road's (for tests and for the budget).</summary>
        public int TileCopies => terrain.Count + road.Count;

        /// <summary>Whether the backdrop is drawn (the quality governor hides it on a slow device).</summary>
        public bool BackdropVisible
        {
            get => backdrop.gameObject.activeSelf;
            set => backdrop.gameObject.SetActive(value);
        }

        /// <summary>Whether the shadow under the hero is drawn (hidden together with the backdrop on a slow device).</summary>
        public bool ShadowVisible
        {
            get => shadow.gameObject.activeSelf;
            set => shadow.gameObject.SetActive(value);
        }

        /// <summary>Puts the world where it belongs for a hero at this z and height, seen from a camera at this position.</summary>
        public void Sync(float heroZ, float heroY, Vector3 cameraPosition)
        {
            sky.position = cameraPosition;
            backdrop.position = new Vector3(cameraPosition.x, 0f, cameraPosition.z);

            var tileBase = WorldPlacement.TileBase(heroZ);
            if (tileBase != placedBase)
            {
                placedBase = tileBase;
                for (var i = 0; i < terrain.Count; i++)
                {
                    var z = WorldPlacement.TileZ(i, heroZ);
                    terrain[i].position = new Vector3(0f, TerrainY, z);
                    road[i].position = new Vector3(0f, RoadY, z);
                }
            }

            if (shadow.gameObject.activeSelf)
            {
                var lift = Mathf.Clamp01(heroY / 2.5f);
                shadow.position = new Vector3(0f, ShadowY, heroZ);
                var size = Mathf.Lerp(1.55f, 0.85f, lift);
                shadow.localScale = new Vector3(size, size, 1f);
                shadowMaterial.SetColor("_Color", new Color(0.02f, 0.01f, 0.03f, Mathf.Lerp(0.55f, 0.18f, lift)));
            }
        }

        static Transform MakeMeshObject(string name, Mesh mesh, Material material, Transform parent)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = material;
            return go.transform;
        }

        // A unit quad in the XY plane, clockwise seen from -Z like Unity's own, so rotated flat onto the ground it faces up.
        static Mesh MakeQuad()
        {
            var m = new Mesh { name = "HeroShadowQuad" };
            m.vertices = new[] { new Vector3(-0.5f, -0.5f, 0f), new Vector3(0.5f, -0.5f, 0f), new Vector3(0.5f, 0.5f, 0f), new Vector3(-0.5f, 0.5f, 0f) };
            m.uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, 1), new Vector2(0, 1) };
            m.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            m.RecalculateNormals();
            return m;
        }

        // A UV sphere of radius 1 whose inside the sky shader draws (the shader culls the front faces).
        static Mesh MakeSphere(int segments, int rings)
        {
            var verts = new List<Vector3>();
            var tris = new List<int>();
            for (var r = 0; r <= rings; r++)
            {
                var v = Mathf.PI * r / rings;
                for (var s = 0; s <= segments; s++)
                {
                    var u = 2f * Mathf.PI * s / segments;
                    verts.Add(new Vector3(Mathf.Sin(v) * Mathf.Cos(u), Mathf.Cos(v), Mathf.Sin(v) * Mathf.Sin(u)));
                }
            }
            for (var r = 0; r < rings; r++)
            {
                for (var s = 0; s < segments; s++)
                {
                    var a = r * (segments + 1) + s;
                    var b = a + segments + 1;
                    tris.AddRange(new[] { a, b, a + 1, a + 1, b, b + 1 });
                }
            }
            var m = new Mesh { name = "SkyDome" };
            m.SetVertices(verts);
            m.SetTriangles(tris, 0);
            m.bounds = new Bounds(Vector3.zero, Vector3.one * 2f);
            return m;
        }

        static Transform Clone(string name, GameObject model, Transform root)
        {
            var wrapper = new GameObject(name).transform;
            wrapper.SetParent(root, false);
            Object.Instantiate(model, wrapper).SetActive(true);
            return wrapper;
        }
    }
}
