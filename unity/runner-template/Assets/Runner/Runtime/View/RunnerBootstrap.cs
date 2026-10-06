using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using GLTFast.Materials;
using Runner.Loading;
using Runner.Settings;
using Runner.Sim;
using UnityEngine;
using UnityEngine.InputSystem;

namespace Runner.View
{
    /// <summary>
    /// Entry point of the template. Reads the settings URL from the page, loads the settings and the three
    /// models, builds the scene from code and then runs the simulation. Any failure stops the game and is
    /// shown on screen.
    /// </summary>
    public sealed class RunnerBootstrap : MonoBehaviour
    {
        public enum BootState { Loading, Ready, Failed }

        const float HeroHeight = 1f;
        const float CollectibleHeight = 0.5f;
        const float VisibleDistance = 65f; // matches RunnerSim: 5 m behind to 60 m ahead

        /// <summary>Test hook: use this settings URL instead of the page's settings parameter.</summary>
        public string SettingsUrlOverride;


        public BootState State { get; private set; } = BootState.Loading;
        public string Error { get; private set; }
        public RunnerSim Sim { get; private set; }
        public RunnerView View => view;

        Hud hud;
        RunnerView view;
        EnvironmentView environment; // null when the settings have no environment
        WorldView worldView; // null unless the settings have a High world
        // The three files of a High world (terrain.glb, road.glb, backdrop.glb), loaded and kept hidden until the world view takes them; empty without a world.
        readonly Dictionary<string, GameObject> worldModels = new Dictionary<string, GameObject>();

        async void Start()
        {
            hud = gameObject.AddComponent<Hud>();
            hud.ShowFps = UrlTools.TryGetQueryParam(Application.absoluteURL, "debug", out var debug) && debug == "1";
            try
            {
                await Boot();
            }
            catch (LoadException e)
            {
                Fail(e.Message);
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                Fail("unexpected error: " + e.Message);
            }
        }

        async Task Boot()
        {
            var stopwatch = System.Diagnostics.Stopwatch.StartNew(); // the time to ready is logged below: it is a budget (15 seconds)
            var pageUrl = Application.absoluteURL;
            var settingsUrl = ResolveSettingsUrl(pageUrl);

            string json;
            try
            {
                json = await AssetLoader.FetchText(settingsUrl);
            }
            catch (LoadException e)
            {
                throw new LoadException("settings (" + settingsUrl + "): " + e.Message);
            }

            var parsed = SettingsParser.Parse(json);
            if (!parsed.Ok) throw new LoadException(parsed.Error);
            var settings = parsed.Settings;

            var root = new GameObject("World").transform;
            root.SetParent(transform, false);
            try
            {
                // The shader reaches the player through Always Included Shaders (BuildScript), not through the scene.
                var flatShader = Shader.Find("Runner/Flat");
                if (flatShader == null) throw new LoadException("the Runner/Flat shader is missing from this build");
                var flat = new Material(flatShader);
                IMaterialGenerator generator = new FlatMaterialGenerator(flat);
                // A lit game (any High model or environment) makes its materials from the lit shader instead; the flat one still draws the plain ground.
                var lit = SettingsParser.IsLit(settings);
                if (lit)
                {
                    var litShader = Shader.Find("Runner/Lit");
                    if (litShader == null) throw new LoadException("the Runner/Lit shader is missing from this build");
                    generator = new LitMaterialGenerator(new Material(litShader));
                }
                var hero = await LoadRole(root, settingsUrl, "hero", settings.roles.hero, HeroHeight, generator);
                var obstacle = await LoadRole(root, settingsUrl, "obstacle", settings.roles.obstacle, RunnerSim.ObstacleHeight, generator);
                var collectible = await LoadRole(root, settingsUrl, "collectible", settings.roles.collectible, CollectibleHeight, generator);

                // The environment is optional (settings from before it existed have none): the sky is its palette pick instead of slot 0,
                // and the field, the stripes and the scenery are added. Without one nothing below changes.
                var hasEnvironment = SettingsParser.HasEnvironment(settings);
                var sceneryModels = new List<GameObject>();
                if (hasEnvironment)
                {
                    foreach (var file in settings.environment.scenery ?? new string[0])
                        sceneryModels.Add(await LoadScenery(root, settingsUrl, file, generator));
                }

                // A High environment also has a world, whose three files must be next to the settings: a missing one stops the game, naming the file.
                if (SettingsParser.HasWorld(settings))
                {
                    foreach (var file in SettingsParser.WorldFiles)
                        worldModels[file] = await LoadWorldPiece(root, settingsUrl, file, generator);
                }

                Sim = new RunnerSim(settings.tuning);
                var poolSize = Mathf.CeilToInt(VisibleDistance / settings.tuning.obstacleSpacing) + 2;
                var sky = PaletteColor(settings, hasEnvironment ? settings.environment.sky : 0);
                var fieldColor = PaletteColor(settings, hasEnvironment ? settings.environment.field : 1);
                var hasWorld = SettingsParser.HasWorld(settings);
                view = new RunnerView(root, hero, obstacle, collectible, sky, PaletteColor(settings, 1), flat, poolSize);
                if (hasEnvironment)
                {
                    var world = settings.environment;
                    // With a world the terrain and the road are the ground, so the plain field and stripes are not drawn; the scenery is as ever.
                    environment = new EnvironmentView(root, sceneryModels, PaletteColor(settings, world.field), PaletteColor(settings, world.stripe),
                                                      flat, SceneryLayout.Spacing(world.density), !hasWorld);
                }
                if (hasWorld)
                {
                    worldView = new WorldView(root, worldModels, WorldLook.For(settings.environment.world.style, sky, fieldColor));
                    view.HideGround();
                }
                else if (lit)
                {
                    WorldLook.For("meadow", sky, fieldColor).Apply(); // the lit shader reads its sun, sky and fog from globals, world or not
                }
                hud.PanelColor = PaletteColor(settings, 2);
                hud.PanelTextColor = PaletteColor(settings, 0);
                hud.ScoreColor = PaletteColor(settings, 4);
            }
            catch
            {
                Destroy(root.gameObject);
                throw;
            }

            hud.Loading = false;
            State = BootState.Ready;
            Debug.Log("RUNNER ready in " + stopwatch.ElapsedMilliseconds + " ms");
        }

        string ResolveSettingsUrl(string pageUrl)
        {
            var url = SettingsUrlOverride;
            if (string.IsNullOrEmpty(url)) UrlTools.TryGetQueryParam(pageUrl, "settings", out url);
            if (string.IsNullOrEmpty(url))
            {
#if UNITY_EDITOR
                url = new Uri(Path.Combine(Application.streamingAssetsPath, "sample", "settings.json")).AbsoluteUri;
#else
                throw new LoadException("No game settings were given. Open this page with ?settings=<url>");
#endif
            }
            return UrlTools.ToAbsolute(pageUrl, url);
        }

        static async Task<GameObject> LoadRole(Transform root, string settingsUrl, string role, string file, float height, IMaterialGenerator generator)
        {
            try
            {
                var content = await AssetLoader.LoadModel(UrlTools.SiblingUrl(settingsUrl, file), root, generator);
                return Fit(content, height);
            }
            catch (Exception e) when (e is LoadException || e is ArgumentException)
            {
                throw new LoadException(role + " (" + file + "): " + e.Message);
            }
        }

        static async Task<GameObject> LoadScenery(Transform root, string settingsUrl, string file, IMaterialGenerator generator)
        {
            try
            {
                var content = await AssetLoader.LoadModel(UrlTools.SiblingUrl(settingsUrl, file), root, generator);
                return FitScenery(content);
            }
            catch (Exception e) when (e is LoadException || e is ArgumentException)
            {
                throw new LoadException("scenery (" + file + "): " + e.Message);
            }
        }

        static async Task<GameObject> LoadWorldPiece(Transform root, string settingsUrl, string file, IMaterialGenerator generator)
        {
            try
            {
                var content = await AssetLoader.LoadModel(UrlTools.SiblingUrl(settingsUrl, file), root, generator);
                if (content.GetComponentsInChildren<Renderer>(true).Length == 0) throw new LoadException("has no visible geometry");
                content.SetActive(false); // kept for the world view; nothing of it is drawn where it was loaded
                return content;
            }
            catch (Exception e) when (e is LoadException || e is ArgumentException)
            {
                throw new LoadException("world (" + file + "): " + e.Message);
            }
        }

        // Scenery keeps the size Blender built it at (its own height is the target) and stands on the origin: it is never capped by the hit
        // window, because it is never hit.
        static GameObject FitScenery(GameObject content)
        {
            var renderers = content.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) throw new LoadException("has no visible geometry");

            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            var (scale, offset) = ModelFit.Compute(bounds, bounds.size.y);
            content.transform.localScale = Vector3.one * scale;
            content.transform.localPosition = offset;
            content.SetActive(false);
            return content;
        }

        // Stands the model on the origin at the target height and hides it; the view clones it.
        static GameObject Fit(GameObject content, float height)
        {
            var renderers = content.GetComponentsInChildren<Renderer>();
            if (renderers.Length == 0) throw new LoadException("has no visible geometry");

            var bounds = renderers[0].bounds;
            for (var i = 1; i < renderers.Length; i++) bounds.Encapsulate(renderers[i].bounds);
            // Never wider or longer than the hit window: a bigger model would look like it hits things it does not touch.
            var (scale, offset) = ModelFit.Compute(bounds, height, 2f * RunnerSim.HitHalfWidth);
            content.transform.localScale = Vector3.one * scale;
            content.transform.localPosition = offset;
            content.SetActive(false);
            return content;
        }

        static Color PaletteColor(GameSettings settings, int index)
        {
            ColorUtility.TryParseHtmlString(settings.palette[index], out var color); // validated as #rrggbb
            return color;
        }

        void Fail(string message)
        {
            State = BootState.Failed;
            Error = message;
            Debug.LogError("Runner: " + message);
            if (hud != null) hud.ErrorMessage = message;
        }

        void Update()
        {
            if (State != BootState.Ready) return;

            var pressed = Pressed();
            if (Sim.GameOver)
            {
                if (pressed) Sim.Restart();
            }
            else
            {
                Sim.Tick(Time.deltaTime, pressed);
            }
            view.Sync(Sim);
            environment?.Sync(Sim.Z);
            worldView?.Sync(Sim.Z, Sim.HeroY, view.CameraPosition);
            hud.Score = Sim.Score;
            hud.GameOver = Sim.GameOver;
        }

        // One press covers mouse, touch and pen, so a tap on a phone is exactly one jump.
        static bool Pressed()
        {
            return (Pointer.current != null && Pointer.current.press.wasPressedThisFrame)
                   || (Keyboard.current != null && Keyboard.current.spaceKey.wasPressedThisFrame);
        }
    }
}
