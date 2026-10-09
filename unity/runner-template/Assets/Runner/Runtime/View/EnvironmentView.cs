using System.Collections.Generic;
using UnityEngine;

namespace Runner.View
{
    /// <summary>
    /// The world around the track when the settings have an environment: a wide field under it, two edge stripes (one combined mesh, one
    /// renderer) and the scenery, a fixed pool of wrappers along both sides that is recycled by the hero's distance. Scenery is only
    /// drawn: RunnerSim never sees it, so it is never a hit target.
    /// </summary>
    public sealed class EnvironmentView
    {
        const float FieldWidth = 120f;
        const float FieldLength = 400f;
        const float FieldY = -0.15f; // its top is just under the track's top (0)
        const float StripeWidth = 0.3f;
        const float StripeX = 4f; // the track's edge
        const float StripeY = 0.03f; // a little above the track and the field, so neither fights it for the pixel
        const float AheadOfHero = 100f; // the field and the stripes are centred this far ahead, as the ground is

        readonly Transform field;
        readonly Transform stripes;
        readonly List<Transform> scenery = new List<Transform>();
        readonly int[] slots; // the slot each wrapper stands in now, so a wrapper is only moved when its slot changes
        readonly int poolSize;
        readonly float spacing;
        readonly float sideExtra; // further out from the middle than the runner's track, for a wider field
        readonly float zShift;    // added to every slot's z (a script game's follow target may be below zero, and slots start at zero)

        /// <param name="sceneryModels">The fitted, hidden prototypes: one wrapper clones <c>sceneryModels[ModelForSlot(...)]</c> and never any other.</param>
        /// <param name="drawGround">False in a High world, whose terrain and road are the ground: then only the scenery is made.</param>
        public EnvironmentView(Transform root, IReadOnlyList<GameObject> sceneryModels, Color fieldColor, Color stripeColor, Material flat, float spacing, bool drawGround = true, float sideExtra = 0f, float zShift = 0f)
        {
            this.spacing = spacing;
            this.sideExtra = sideExtra;
            this.zShift = zShift;

            if (drawGround)
            {
                field = TintedCube("Field", root, new Vector3(FieldWidth, 0.2f, FieldLength), flat, fieldColor);
                stripes = Stripes(root, flat, stripeColor);
            }

            var models = sceneryModels.Count;
            poolSize = models == 0 ? 0 : SceneryLayout.PoolSize(spacing, models);
            slots = new int[2 * poolSize];
            for (var side = 0; side < 2; side++)
            {
                for (var i = 0; i < poolSize; i++)
                {
                    var wrapper = new GameObject("Scenery").transform;
                    wrapper.SetParent(root, false);
                    Object.Instantiate(sceneryModels[SceneryLayout.ModelForSlot(i, side, models)], wrapper).SetActive(true);
                    LoopClips.Start(wrapper, Random.value); // a tree or a windmill moves; each clone starts at its own point
                    scenery.Add(wrapper);
                    slots[side * poolSize + i] = -1;
                }
            }
        }

        /// <summary>Every scenery wrapper, the left side's pool and then the right side's.</summary>
        public IReadOnlyList<Transform> Scenery => scenery;

        /// <summary>How much of the scenery is drawn (the quality governor's choice): 0 all of it, 1 every other item of each side, 2 none.</summary>
        public void SetSceneryDetail(int detail)
        {
            for (var i = 0; i < scenery.Count; i++)
            {
                var shown = detail == 0 || (detail == 1 && (i % poolSize) % 2 == 0);
                if (scenery[i].gameObject.activeSelf != shown) scenery[i].gameObject.SetActive(shown);
            }
        }

        /// <summary>Moves the field and the stripes with the hero, and puts each wrapper in the slot it stands in for a hero at this z.</summary>
        public void Sync(float heroZ)
        {
            if (field != null) field.localPosition = new Vector3(0f, FieldY, heroZ + AheadOfHero);
            if (stripes != null) stripes.localPosition = new Vector3(0f, StripeY, heroZ + AheadOfHero);

            var first = SceneryLayout.FirstSlot(heroZ, spacing);
            for (var side = 0; side < 2; side++)
            {
                for (var i = 0; i < poolSize; i++)
                {
                    var index = side * poolSize + i;
                    var slot = SceneryLayout.SlotForItem(i, first, poolSize);
                    if (slots[index] == slot) continue;
                    slots[index] = slot;
                    var x = SceneryLayout.SideX(slot, side);
                    scenery[index].localPosition = new Vector3(x + (x < 0f ? -sideExtra : sideExtra), 0f, SceneryLayout.SlotZ(slot, spacing) + zShift);
                }
            }
        }

        static Transform TintedCube(string name, Transform root, Vector3 scale, Material flat, Color color)
        {
            var cube = GameObject.CreatePrimitive(PrimitiveType.Cube);
            cube.name = name;
            Object.Destroy(cube.GetComponent<Collider>());
            cube.transform.SetParent(root, false);
            cube.transform.localScale = scale;
            var renderer = cube.GetComponent<Renderer>();
            if (flat != null) renderer.sharedMaterial = flat;
            renderer.material.color = color; // .material makes a per-view copy to tint
            return cube.transform;
        }

        // Two thin strips along the track's edges as one mesh, so they cost one renderer. The quads face up (clockwise seen from above).
        static Transform Stripes(Transform root, Material flat, Color color)
        {
            var half = FieldLength / 2f;
            var vertices = new List<Vector3>();
            var triangles = new List<int>();
            foreach (var centre in new[] { -StripeX, StripeX })
            {
                var x0 = centre - StripeWidth / 2f;
                var x1 = centre + StripeWidth / 2f;
                var start = vertices.Count;
                vertices.Add(new Vector3(x0, 0f, -half));
                vertices.Add(new Vector3(x0, 0f, half));
                vertices.Add(new Vector3(x1, 0f, half));
                vertices.Add(new Vector3(x1, 0f, -half));
                triangles.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
            }

            var mesh = new Mesh { name = "Stripes" };
            mesh.SetVertices(vertices);
            mesh.SetTriangles(triangles, 0);
            mesh.SetNormals(new List<Vector3>(new[] { Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up, Vector3.up }));
            mesh.RecalculateBounds();

            var stripeObject = new GameObject("Stripes");
            stripeObject.transform.SetParent(root, false);
            stripeObject.AddComponent<MeshFilter>().sharedMesh = mesh;
            var renderer = stripeObject.AddComponent<MeshRenderer>();
            if (flat != null) renderer.sharedMaterial = flat;
            renderer.material.color = color;
            return stripeObject.transform;
        }
    }
}
