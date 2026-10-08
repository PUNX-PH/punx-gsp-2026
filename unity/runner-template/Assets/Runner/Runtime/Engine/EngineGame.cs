using System.Collections.Generic;
using UnityEngine;

namespace Runner.Engine
{
    /// <summary>Whether the settings file carries a game spec (the "game" key), and what came of reading it.</summary>
    public sealed class GameRead
    {
        public bool Present;
        public EngineSpec Spec;
        public string Error;
    }

    /// <summary>
    /// Plays a game spec in Unity: steps the engine at 60 Hz from the frame clock and the pointer, and draws every live object. Objects are the
    /// entity's loaded model (entity-NAME.glb next to the settings) or a primitive made in code in the entity's palette color; clones are recycled.
    /// The camera follows the spec's camera: side looks along the field's x and y; top and behind map the field's y to depth.
    /// </summary>
    public sealed class EngineGame
    {
        const float Step = 1f / 60f;
        const int MaxStepsPerFrame = 5;

        readonly EngineSpec spec;
        readonly Transform root;
        readonly Dictionary<string, GameObject> models; // fitted, hidden templates by entity name; absent for a primitive
        readonly Dictionary<string, Material> materials = new Dictionary<string, Material>();
        readonly Dictionary<int, GameObject> live = new Dictionary<int, GameObject>();
        readonly Dictionary<string, Stack<GameObject>> spare = new Dictionary<string, Stack<GameObject>>();
        readonly List<Color> palette = new List<Color>();
        readonly Material flat;
        Camera camera;
        Engine engine;
        float accumulator;
        bool pendingTap;

        public EngineSpec Spec => spec;
        public Engine Engine => engine;
        public Color Background { get; private set; }

        /// <summary>Reads the "game" key of a settings file. Present is false when there is none (the old runner settings).</summary>
        public static GameRead Read(string settingsJson)
        {
            if (!MiniJson.TryParse(settingsJson, out var root, out _) || !(root is JsonObject top) || !top.Has("game")) return new GameRead();
            var read = new GameRead { Present = true };
            if (SpecParser.TryParseValue(top.Get("game"), settingsJson.Length, out read.Spec, out read.Error)) read.Error = null;
            return read;
        }

        public EngineGame(Transform parent, EngineSpec spec, Dictionary<string, GameObject> models, Material flat)
        {
            this.spec = spec;
            this.models = models;
            this.flat = flat;
            root = new GameObject("Game").transform;
            root.SetParent(parent, false);
            foreach (var hex in spec.Palette)
            {
                ColorUtility.TryParseHtmlString(hex, out var c); // validated as #rrggbb
                palette.Add(c);
            }
            Background = Color.Lerp(palette[0], Color.black, 0.75f);
            BuildCamera();
            engine = new Engine(spec);
        }

        /// <summary>The palette slot as a color (the spec's own look).</summary>
        public Color Slot(int index) => palette[Mathf.Clamp(index, 0, palette.Count - 1)];

        void BuildCamera()
        {
            var cameraObject = new GameObject("Camera") { tag = "MainCamera" };
            cameraObject.transform.SetParent(root, false);
            camera = cameraObject.AddComponent<Camera>();
            camera.clearFlags = CameraClearFlags.SolidColor;
            camera.backgroundColor = Background;
            camera.nearClipPlane = 0.1f;
            camera.farClipPlane = 200f;
            Frame();
        }

        /// <summary>Fits the camera to the field and the screen's shape; called every frame because the window can change.</summary>
        void Frame()
        {
            var w = spec.Width / 1000f;
            var h = spec.Height / 1000f;
            var aspect = Mathf.Max(0.2f, camera.aspect);
            var t = camera.transform;
            if (spec.Camera == "side")
            {
                camera.orthographic = true;
                camera.orthographicSize = Mathf.Max(h / 2f, w / 2f / aspect) + 0.25f;
                t.position = new Vector3(w / 2f, h / 2f, -20f);
                t.rotation = Quaternion.identity;
            }
            else if (spec.Camera == "top")
            {
                camera.orthographic = true;
                camera.orthographicSize = Mathf.Max(h / 2f, w / 2f / aspect) + 0.25f;
                t.position = new Vector3(w / 2f, 20f, h / 2f);
                t.rotation = Quaternion.Euler(90f, 0f, 0f);
            }
            else
            {
                camera.orthographic = false;
                camera.fieldOfView = 55f;
                var back = Mathf.Max(5f, w / aspect);
                t.position = new Vector3(w / 2f, back * 0.9f, -back * 0.8f);
                t.LookAt(new Vector3(w / 2f, 0f, h * 0.3f));
            }
        }

        Material MaterialFor(int slot)
        {
            var key = slot.ToString();
            if (materials.TryGetValue(key, out var m)) return m;
            m = new Material(flat) { color = Slot(slot) };
            materials[key] = m;
            return m;
        }

        Vector3 WorldPoint(long x, long y)
        {
            return spec.Camera == "side" ? new Vector3(x / 1000f, y / 1000f, 0f) : new Vector3(x / 1000f, 0f, y / 1000f);
        }

        GameObject Create(EntityDef def)
        {
            if (models.TryGetValue(def.Name, out var template))
            {
                var clone = Object.Instantiate(template, root);
                clone.SetActive(true);
                return clone;
            }
            var go = new GameObject(def.Name);
            go.transform.SetParent(root, false);
            go.AddComponent<MeshFilter>().sharedMesh = PrimitiveMeshes.Get(def.Model);
            go.AddComponent<MeshRenderer>().sharedMaterial = MaterialFor((int)def.Color);
            return go;
        }

        void Place(GameObject go, Obj o)
        {
            var def = o.Def;
            var w = o.W / 1000f;
            var h = o.H / 1000f;
            var t = go.transform;
            if (models.ContainsKey(def.Name))
            {
                // A model stands on its origin: the bottom center of its box.
                var p = WorldPoint(o.X + o.W / 2, o.Y);
                t.localPosition = spec.Camera == "side" ? p : new Vector3(p.x, 0f, (o.Y + o.H / 2) / 1000f);
                return;
            }
            var depth = Mathf.Min(w, h);
            if (spec.Camera == "side")
            {
                t.localPosition = new Vector3(o.X / 1000f + w / 2f, o.Y / 1000f + h / 2f, 0f);
                t.localScale = new Vector3(w, h, depth);
            }
            else
            {
                t.localPosition = new Vector3(o.X / 1000f + w / 2f, depth / 2f, o.Y / 1000f + h / 2f);
                t.localScale = new Vector3(w, depth, h);
            }
        }

        /// <summary>Draws the engine's live objects: new ones get a clone, gone ones give theirs back.</summary>
        void Sync()
        {
            var seen = new HashSet<int>();
            foreach (var o in engine.Objs)
            {
                if (!o.Alive || o.Spawner) continue;
                seen.Add(o.Id);
                if (!live.TryGetValue(o.Id, out var go))
                {
                    if (spare.TryGetValue(o.Type, out var pool) && pool.Count > 0) go = pool.Pop();
                    else go = Create(o.Def);
                    go.SetActive(true);
                    live[o.Id] = go;
                }
                Place(go, o);
            }
            List<int> gone = null;
            foreach (var id in live.Keys) if (!seen.Contains(id)) (gone ?? (gone = new List<int>())).Add(id);
            if (gone == null) return;
            foreach (var id in gone)
            {
                var go = live[id];
                live.Remove(id);
                go.SetActive(false);
                var type = go.name.Replace("(Clone)", "");
                if (!spare.TryGetValue(type, out var pool)) spare[type] = pool = new Stack<GameObject>();
                pool.Push(go);
            }
        }

        /// <summary>Counters for the HUD.</summary>
        public int Score => engine.Counters.TryGetValue("score", out var v) ? (int)v : 0;
        public string Subtitle => engine.Counters.TryGetValue("lives", out var v) ? "Lives " + v : null;
        public bool Over => engine.Status != Status.Running;
        public string EndText => engine.Status == Status.Won ? "You win\nTap to play again" : "Game over\nTap to restart";

        /// <summary>Runs the engine for the frame's time. A press while the round is over starts a new round.</summary>
        public void Tick(float deltaTime, bool pressed, bool held)
        {
            if (Over)
            {
                if (pressed) Restart();
            }
            else
            {
                pendingTap |= pressed;
                accumulator += Mathf.Min(deltaTime, MaxStepsPerFrame * Step);
                var steps = 0;
                while (accumulator >= Step && steps < MaxStepsPerFrame && !Over)
                {
                    engine.Run(new SimInput { Tap = pendingTap, Hold = held });
                    pendingTap = false;
                    accumulator -= Step;
                    steps++;
                }
            }
            Frame();
            Sync();
        }

        void Restart()
        {
            foreach (var go in live.Values) go.SetActive(false);
            foreach (var kv in live)
            {
                var type = kv.Value.name.Replace("(Clone)", "");
                if (!spare.TryGetValue(type, out var pool)) spare[type] = pool = new Stack<GameObject>();
                pool.Push(kv.Value);
            }
            live.Clear();
            engine = new Engine(spec);
            accumulator = 0f;
            pendingTap = false;
        }
    }
}
