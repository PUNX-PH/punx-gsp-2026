using System;
using System.Collections.Generic;
using Runner.Engine;
using Runner.View;
using UnityEngine;

namespace Runner.Scripting
{
    /// <summary>
    /// Plays a script game in Unity: steps the <see cref="ScriptRunner"/> from the frame time and the pointer, and draws its world. An object is the
    /// loaded model of its kind (entity-NAME.glb next to the settings) or a primitive made in code, tinted with its color; clones are recycled.
    /// The camera follows what the script chose. In side, fixed, side2d and top2d the field is seen head on (x right, y up, z depth away from the
    /// viewer). In top and chase the field is the ground: x is right, y runs away from the viewer and z is height. The 2d modes are orthographic.
    /// </summary>
    public sealed class ScriptView
    {
        static readonly int BaseColor = Shader.PropertyToID("_BaseColor");
        static readonly Color DefaultColor = new Color(0.9f, 0.9f, 0.9f);

        sealed class Drawn
        {
            public GameObject Root;
            public Renderer Renderer; // null for a model, which keeps the colors it came with
            public string Color;
            public bool IsModel;
        }

        readonly Transform root;
        readonly Func<ScriptRunner> makeRunner;
        readonly Dictionary<string, GameObject> models; // fitted to one unit tall, hidden templates by kind
        readonly Material flat;
        Renderer groundRenderer;
        Color? skyColor;                 // the environment's sky, when the game has one
        EnvironmentView scenery;         // the environment's scenery, drawn along the follow target in the ground cameras
        bool sceneryShown = true;
        const float SceneryBias = 1000f; // slots start at zero, so the follow target's y is lifted by this and the scenery's z lowered by it
        readonly Color[] palette;
        readonly Dictionary<int, Drawn> live = new Dictionary<int, Drawn>();
        readonly Dictionary<string, Stack<Drawn>> spare = new Dictionary<string, Stack<Drawn>>();
        readonly Dictionary<string, Color> parsed = new Dictionary<string, Color>();
        readonly MaterialPropertyBlock block = new MaterialPropertyBlock();
        readonly HashSet<int> seen = new HashSet<int>();
        readonly List<int> gone = new List<int>();
        Camera camera;
        GameObject ground;
        Vector2 lastField;
        bool previousDown;

        public ScriptRunner Runner { get; private set; }
        public Color Background { get; }
        public bool Over => Runner.Over;
        public bool Failed => Runner.Failed;
        public string Error => Runner.Error;
        public int Score => Mathf.RoundToInt((float)Runner.Api.Score);

        public string EndText
        {
            get
            {
                var title = Runner.Api.Outcome == GameOutcome.Won ? "You win" : "Game over";
                var message = string.IsNullOrEmpty(Runner.Api.Message) ? "" : "\n" + Runner.Api.Message;
                return title + message + "\nTap to play again";
            }
        }

        /// <param name="palette">The game's five colors; palette slot 1 is the first.</param>
        /// <param name="makeRunner">Makes a fresh runner (and so a new round); called once now and again on every restart.</param>
        public ScriptView(Transform parent, Func<ScriptRunner> makeRunner, Dictionary<string, GameObject> models, Material flat, IList<Color> palette)
        {
            this.makeRunner = makeRunner;
            this.models = models;
            this.flat = flat;
            this.palette = new Color[5];
            for (var i = 0; i < 5; i++) this.palette[i] = palette.Count == 0 ? DefaultColor : palette[Mathf.Min(i, palette.Count - 1)];
            Background = Color.Lerp(this.palette[0], Color.black, 0.75f);

            root = new GameObject("Script game").transform;
            root.SetParent(parent, false);
            var cameraObject = new GameObject("Camera") { tag = "MainCamera" };
            cameraObject.transform.SetParent(root, false);
            camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Background;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 400f;

            ground = new GameObject("Ground");
            ground.transform.SetParent(root, false);
            ground.AddComponent<MeshFilter>().sharedMesh = PrimitiveMeshes.Get("plane");
            groundRenderer = ground.AddComponent<MeshRenderer>();
            groundRenderer.sharedMaterial = flat;
            block.SetColor(BaseColor, Color.Lerp(this.palette[0], Color.white, 0.22f)); // lit, so it needs to be a visible surface under the sun, not a near-black one
            groundRenderer.SetPropertyBlock(block);

            Runner = makeRunner();
            Runner.Start();
            FrameCamera();
            Sync();
        }

        /// <summary>
        /// The world the environment gave the game: the sky, the color of the ground, and the scenery that stands along both sides of the field (a fixed pool recycled
        /// by the follow target's distance, as in the runner), all of it only where the camera sees a ground (top and chase).
        /// </summary>
        public void SetWorld(Color sky, Color field, IReadOnlyList<GameObject> sceneryModels, float spacing)
        {
            skyColor = Color.Lerp(sky, new Color(0.62f, 0.76f, 0.92f), 0.35f); // the pick, lifted toward daylight so the lit scene is not dim
            block.SetColor(BaseColor, field);
            groundRenderer.SetPropertyBlock(block);
            if (sceneryModels.Count == 0) return;
            var half = Mathf.Max(0f, (float)Runner.World.Width / 2f - 4f); // the runner's scenery stands 7 to 9 m from the middle of a track 4 m from it
            scenery = new EnvironmentView(root, sceneryModels, Color.white, Color.white, flat, spacing, false, half, -SceneryBias);
            scenery.SetSceneryDetail(2);
            sceneryShown = false;
            FrameCamera();
        }

        /// <summary>The color a script named: a palette slot "1" to "5" or "#rrggbb"; the fallback for none.</summary>
        public Color ColorOf(string spec, Color fallback)
        {
            if (string.IsNullOrEmpty(spec)) return fallback;
            if (spec.Length == 1 && spec[0] >= '1' && spec[0] <= '5') return palette[spec[0] - '1'];
            if (parsed.TryGetValue(spec, out var color)) return color;
            if (!ColorUtility.TryParseHtmlString(spec, out color)) color = fallback;
            if (parsed.Count < 256) parsed[spec] = color;
            return color;
        }

        /// <summary>Plays the frame. <paramref name="screen"/> is the pointer in pixels (origin bottom left). A press on an ended round starts a new one.</summary>
        public void Tick(float deltaTime, Vector2 screen, bool down)
        {
            var pressed = down && !previousDown;
            previousDown = down;
            if (Runner.Over)
            {
                if (pressed) Restart();
            }
            else if (!Runner.Failed)
            {
                lastField = ScreenToField(screen, lastField);
                Runner.Step(deltaTime, new PointerState(lastField.x, lastField.y, down));
            }
            FrameCamera();
            Sync();
        }

        void Restart()
        {
            foreach (var kv in live) Recycle(kv.Value, kv.Key);
            live.Clear();
            Runner = makeRunner();
            Runner.Start();
        }

        bool GroundMode
        {
            get
            {
                var mode = Runner.Api.Camera.Mode;
                return mode == "top" || mode == "chase";
            }
        }

        // ---- the camera

        void FrameCamera()
        {
            var world = Runner.World;
            var cam = Runner.Api.Camera;
            var w = (float)world.Width;
            var h = (float)world.Height;
            var zoom = Mathf.Max(0.05f, (float)cam.Zoom);
            var aspect = Mathf.Max(0.2f, camera.aspect);
            var t = camera.transform;

            float cx = (float)cam.X, cy = (float)cam.Y, cz = (float)cam.Z;
            var follow = cam.Follow;
            if (follow != null && follow.Alive && cam.Mode != "fixed")
            {
                cx = (float)follow.X;
                cy = (float)follow.Y;
                cz = (float)follow.Z;
            }

            ground.SetActive(GroundMode);
            // Seen from above or behind there is a horizon: a daytime sky tinted by the game's darkest color, where the flat views keep their dark backdrop.
            camera.backgroundColor = GroundMode ? (skyColor ?? Color.Lerp(palette[0], new Color(0.62f, 0.76f, 0.92f), 0.8f)) : Background;
            if (scenery != null)
            {
                if (sceneryShown != GroundMode)
                {
                    scenery.SetSceneryDetail(GroundMode ? 0 : 2);
                    sceneryShown = GroundMode;
                }
                if (GroundMode) scenery.Sync(cy + SceneryBias);
            }
            if (GroundMode)
            {
                ground.transform.localPosition = new Vector3(cx, -0.01f, cy);
                ground.transform.localScale = new Vector3(Mathf.Max(w * 4f, 40f), 1f, Mathf.Max(h * 6f, 60f));
            }

            switch (cam.Mode)
            {
                case "side2d":
                case "top2d":
                    camera.orthographic = true;
                    camera.orthographicSize = Mathf.Max(h / 2f, w / 2f / aspect) / zoom;
                    t.position = new Vector3(cx, cy, -20f);
                    t.rotation = Quaternion.identity;
                    break;
                case "top":
                {
                    camera.orthographic = false;
                    camera.fieldOfView = 40f;
                    var distance = FitDistance(w, h, aspect, camera.fieldOfView) / zoom;
                    t.position = new Vector3(cx, distance, cy);
                    t.rotation = Quaternion.Euler(90f, 0f, 0f);
                    break;
                }
                case "chase":
                {
                    camera.orthographic = false;
                    camera.fieldOfView = 60f;
                    var baseSize = h / zoom;
                    if (follow == null || !follow.Alive) cy -= h * 0.3f;
                    t.position = new Vector3(cx, cz + baseSize * 0.45f, cy - baseSize * 0.5f);
                    t.LookAt(new Vector3(cx, cz, cy + baseSize * 0.4f));
                    break;
                }
                default: // side and fixed
                {
                    camera.orthographic = false;
                    camera.fieldOfView = 40f;
                    var distance = FitDistance(w, h, aspect, camera.fieldOfView) / zoom;
                    t.position = new Vector3(cx, cy, (cam.Mode == "fixed" && cz != 0f ? cz : cz - distance));
                    t.rotation = Quaternion.identity;
                    break;
                }
            }
        }

        static float FitDistance(float w, float h, float aspect, float fovDegrees)
        {
            var tan = Mathf.Tan(fovDegrees * Mathf.Deg2Rad / 2f);
            return Mathf.Max(h / 2f / tan, w / 2f / (tan * aspect)) * 1.05f + 1f;
        }

        /// <summary>Where a pixel is on the field: the ray through it meets the field's plane (z = 0 head on, or the ground).</summary>
        Vector2 ScreenToField(Vector2 screen, Vector2 fallback)
        {
            var ray = camera.ScreenPointToRay(new Vector3(screen.x, screen.y, 0f));
            var ground = GroundMode;
            var plane = ground ? new Plane(Vector3.up, Vector3.zero) : new Plane(Vector3.back, Vector3.zero);
            if (!plane.Raycast(ray, out var enter)) return fallback;
            var p = ray.GetPoint(enter);
            return ground ? new Vector2(p.x, p.z) : new Vector2(p.x, p.y);
        }

        // ---- the objects

        Drawn Create(string kind)
        {
            if (models.TryGetValue(kind, out var template))
            {
                var holder = new GameObject(kind);
                holder.transform.SetParent(root, false);
                var clone = UnityEngine.Object.Instantiate(template, holder.transform);
                clone.SetActive(true);
                return new Drawn { Root = holder, IsModel = true };
            }
            var go = new GameObject(kind);
            go.transform.SetParent(root, false);
            go.AddComponent<MeshFilter>().sharedMesh = PrimitiveMeshes.Get(kind);
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = flat;
            return new Drawn { Root = go, Renderer = renderer };
        }

        void Place(Drawn d, ScriptObject o)
        {
            var ground = GroundMode;
            var w = Mathf.Max(0.01f, (float)o.W);
            var h = Mathf.Max(0.01f, (float)o.H);
            var depth = Mathf.Max(0.01f, (float)o.D);
            var x = (float)o.X;
            var y = (float)o.Y;
            var z = (float)o.Z;
            var t = d.Root.transform;
            t.localRotation = ground ? Quaternion.Euler(0f, -(float)o.Angle, 0f) : Quaternion.Euler(0f, 0f, (float)o.Angle);
            if (d.IsModel)
            {
                // A model is one unit tall and stands on its origin: scale it by the object's height and put its feet at the object's lower edge.
                if (ground)
                {
                    t.localScale = Vector3.one * depth;
                    t.localPosition = new Vector3(x, Mathf.Max(0f, z - depth / 2f), y); // never below the ground: a script that left z at 0 still has its model standing on it
                }
                else
                {
                    t.localScale = Vector3.one * h;
                    t.localPosition = new Vector3(x, y - h / 2f, z);
                }
                return;
            }
            if (ground)
            {
                t.localPosition = new Vector3(x, Mathf.Max(z, depth / 2f), y); // never sunk into the ground: a script that left z at 0 still has its object resting on it
                t.localScale = new Vector3(w, depth, h);
            }
            else
            {
                t.localPosition = new Vector3(x, y, z);
                t.localScale = new Vector3(w, h, depth);
            }
            if (d.Color != o.Color || d.Color == null)
            {
                d.Color = o.Color;
                block.SetColor(BaseColor, ColorOf(o.Color, DefaultColor));
                d.Renderer.SetPropertyBlock(block);
            }
        }

        /// <summary>Draws the world's live objects: new ones get a clone, gone ones give theirs back.</summary>
        void Sync()
        {
            seen.Clear();
            var objects = Runner.World.Objects;
            for (var i = 0; i < objects.Count; i++)
            {
                var o = objects[i];
                if (!o.Alive) continue;
                seen.Add(o.Id);
                if (!live.TryGetValue(o.Id, out var d))
                {
                    if (spare.TryGetValue(o.Kind, out var pool) && pool.Count > 0) d = pool.Pop();
                    else d = Create(o.Kind);
                    d.Root.SetActive(true);
                    d.Color = null;
                    live[o.Id] = d;
                }
                Place(d, o);
            }
            gone.Clear();
            foreach (var id in live.Keys)
                if (!seen.Contains(id)) gone.Add(id);
            foreach (var id in gone)
            {
                Recycle(live[id], id);
                live.Remove(id);
            }
        }

        void Recycle(Drawn d, int id)
        {
            d.Root.SetActive(false);
            var kind = d.Root.name;
            if (!spare.TryGetValue(kind, out var pool)) spare[kind] = pool = new Stack<Drawn>();
            if (pool.Count < 64) pool.Push(d);
            else UnityEngine.Object.Destroy(d.Root);
        }
    }
}
