# Slice 1: Unity Runner Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Unity project that builds to WebGL, reads `settings.json` and three GLB files at startup, and plays a one-touch runner using them.

**Architecture:** Game logic (settings parsing, the runner simulation, URL and model-fit helpers) is plain C# with no scene dependencies, so it is tested in Unity's EditMode. A bootstrap component builds the whole scene from code (no hand-authored scene content), loads content with glTFast, and draws the simulation. A build script produces one desktop and one mobile WebGL build.

**Tech Stack:** Unity (current LTS, Unity 6 family) with URP and Input System, glTFast (`com.unity.cloud.gltfast`), Unity Test Framework, Windows PowerShell 5.1 for tooling.

**Spec:** `docs/superpowers/specs/2026-10-02-studio-platform-v1-design.md` (sections "Unity template (runner)", "Preview", "Constraint: Unity licensing", "Build order" item 1).

## Global Constraints

- Unity (current LTS) with the glTFast package; WebGL target; mobile browsers iOS Safari 15+ and Android Chrome 58+.
- Web builds have no C# threads or timers: no `Task.Run`, `Task.Delay`, `System.Threading.Timer` or `CancellationTokenSource` timeouts. Use frame-based code.
- Mobile and desktop texture compression differ: build once per target (ASTC mobile, DXT desktop).
- The template reads the URL parameter `settings=<url>`, loads each role's GLB at runtime with glTFast, and applies the palette and tuning.
- Settings schema v1 is exactly: `{"schemaVersion":1,"template":"runner","palette":["#1b1f3b","#ff6f59","#ffd166","#06d6a0","#ffffff"],"roles":{"hero":"hero.glb","obstacle":"obstacle.glb","collectible":"coin.glb"},"tuning":{"speed":6,"jumpHeight":2.2,"obstacleSpacing":12}}`. Only additive changes within a version, so unknown extra fields must be ignored.
- One-touch runner: the hero moves forward on its own, a tap makes it jump, obstacles must be avoided and collectibles picked up.
- The Unity Editor runs only on the studio's own machine. Nothing in this slice runs it on a server.
- Content is served from the same origin as the build: no cross-origin requests.
- Hypercasual and simple: one template, no extra mechanics, no ads or analytics SDKs.

## Decisions this plan makes (not in the spec; veto at review)

- URP (the Unity 6 default template pipeline) and the Input System package. The HUD uses `OnGUI`, so it needs no assets.
- Validation ranges: `speed` 1 to 20, `jumpHeight` 1.5 to 5, `obstacleSpacing` 4 to 40. Settings outside them are rejected.
- Fixed spawn pattern, no randomness: an obstacle every `obstacleSpacing` metres starting at 20 m, a collectible at each midpoint.
- Any load failure stops the game and shows a message. There are no fallbacks.
- Build budget: 15 MB per WebGL target (Brotli), tightened after the first measurement.
- The repository lives outside OneDrive (Unity's `Library/` folder and `node_modules` break OneDrive sync).

## Review Focus

- `settings` URL missing, 404 or not JSON: a visible message, never a blank page (Task 5 tests, Task 6 browser check).
- A role file that is missing, empty or corrupt: the message names the role and the game does not start (Task 5 test).
- A GLB at the wrong scale or with an off-centre pivot (a Blender step does not exist yet): fitted to a target height with its base at the origin (Task 4 tests).
- Shaders stripped from the player, so models render magenta or black although they work in the Editor (Task 6 check).
- One tap must cause exactly one jump on a phone (touch plus emulated mouse), and a backgrounded tab must not teleport the hero into an obstacle (Task 3 tests, Task 6 phone check).

## File structure

```
tools/check-env.ps1          find Unity, verify WebGL module, refuse OneDrive paths
tools/run-tests.ps1          run EditMode or PlayMode tests, print "<Platform>: N passed, M failed"
tools/make-sample.ps1        write sample GLBs and settings into StreamingAssets
tools/serve.ps1              static file server for local testing
fixtures/settings/           valid.json and invalid-*.json (shared with the future Runner)
unity/runner-template/       the Unity project
  Assets/Runner/Runtime/Settings/{GameSettings,SettingsParser}.cs
  Assets/Runner/Runtime/Sim/RunnerSim.cs
  Assets/Runner/Runtime/Loading/{UrlTools,ModelFit,AssetLoader}.cs
  Assets/Runner/Runtime/View/{RunnerBootstrap,RunnerView,Hud}.cs
  Assets/Runner/Editor/BuildScript.cs
  Assets/Runner/Tests/{EditMode,PlayMode}/
  Assets/StreamingAssets/{sample,sample-broken}/
docs/superpowers/notes/slice1-results.md   measured sizes, fps, device notes
```

Assembly definitions: `Runner.Runtime`, `Runner.Editor`, `Runner.Tests.EditMode`, `Runner.Tests.PlayMode`. Namespaces: `Runner.Settings`, `Runner.Sim`, `Runner.Loading`, `Runner.View`, `Runner.EditorTools`.

---

### Task 1: Environment gate, repository and Unity project

**Files:** Create `tools/check-env.ps1`, `tools/run-tests.ps1`, `.gitignore`, `unity/runner-template/` (project), `unity/runner-template/Assets/Runner/Tests/EditMode/SmokeTests.cs`.

**Interfaces:**
- Produces: `tools/check-env.ps1 -PrintPath` prints the full path of `Unity.exe` and exits 0, or prints what is missing and exits 1. `tools/run-tests.ps1 -Platform EditMode|PlayMode` exits non-zero on any failure.

- [ ] **Step 1 (you, one time): install Unity.** Install Unity Hub and the Editor version Hub marks "LTS", with the **WebGL Build Support** module, and sign in so the Personal licence activates. This cannot be automated.
- [ ] **Step 2 (you, one time): move the project out of OneDrive**, for example to `C:\dev\GameStudioPlatform`, including `.claude/`, `CLAUDE.md`, `.mcp.json` and `docs/`. Open a new Claude Code session in the new folder.
- [ ] **Step 3: Write `tools/check-env.ps1`.** It looks in `C:\Program Files\Unity\Hub\Editor\*\Editor\Unity.exe`, picks the newest `6000.*` version, requires `Editor\Data\PlaybackEngines\WebGLSupport`, and exits 1 if the repo path contains `OneDrive` (override: `-AllowOneDrive`). Run it: `powershell -File tools/check-env.ps1 -PrintPath`. Expected: a path ending in `Unity.exe`, exit code 0.
- [ ] **Step 4: `git init`, add `.gitignore`** with Unity's standard ignores (`Library/`, `Temp/`, `Obj/`, `Logs/`, `UserSettings/`, `Builds/`, `*.csproj`, `*.sln`), keeping `*.meta`. Make the first commit of the existing files: `chore: project setup, vendored skills, spec and plan`.
- [ ] **Step 5: Create the project** `unity/runner-template` in Unity Hub from the Universal 3D (URP) template, so package versions match the Editor. Add package `com.unity.cloud.gltfast` (Package Manager, "Install package by name"). Create the four assembly definitions with the references: Runtime has none besides Unity.InputSystem and glTFast; Editor references Runtime; each test assembly references Runtime and Unity's test assemblies.
- [ ] **Step 6: Write the failing smoke test** in `SmokeTests.cs` (EditMode): `Gltfast_package_is_installed` asserts `System.Type.GetType("GLTFast.GltfImport, glTFast") != null`. Write `tools/run-tests.ps1`, which runs `Unity.exe -batchmode -nographics -projectPath unity/runner-template -runTests -testPlatform <Platform> -testResults Builds/<Platform>.xml -logFile Builds/<Platform>.log`, reads the XML and prints `<Platform>: N passed, M failed`.
- [ ] **Step 7: Run it.** `powershell -File tools/run-tests.ps1 -Platform EditMode`. Expected: `EditMode: 1 passed, 0 failed`. If it fails, fix the package or assembly reference until it passes.
- [ ] **Step 8: Commit** `feat: unity runner project with glTFast and test tooling`.

---

### Task 2: Settings contract

**Files:** Create `fixtures/settings/valid.json` (the schema example from Global Constraints), `fixtures/settings/invalid-*.json` as needed, `Assets/Runner/Runtime/Settings/GameSettings.cs`, `SettingsParser.cs`. Test: `Assets/Runner/Tests/EditMode/SettingsParserTests.cs` (reads fixtures from `../../fixtures/settings` relative to `Application.dataPath`).

**Interfaces:**
- Produces:
  - `[Serializable] class GameSettings { int schemaVersion; string template; string[] palette; Roles roles; Tuning tuning; }`, `class Roles { string hero, obstacle, collectible; }`, `class Tuning { float speed, jumpHeight, obstacleSpacing; }` (public fields, `JsonUtility` compatible).
  - `static ParseResult SettingsParser.Parse(string json)`; `class ParseResult { bool Ok; GameSettings Settings; string Error; }`. Errors read `settings.<field>: <problem>`.

- [ ] **Step 1: Write the failing tests** (names and assertions):
  - `Parse_valid_fixture_returns_settings`: `Ok`, `template == "runner"`, `palette.Length == 5`, `roles.hero == "hero.glb"`, `tuning.speed == 6f`, `tuning.jumpHeight == 2.2f`, `tuning.obstacleSpacing == 12f`.
  - `Parse_ignores_unknown_extra_fields`: valid JSON plus `"future":{"a":1}` is still `Ok`.
  - Each of these is `!Ok` and `Error.Contains(<field>)`: `Parse_rejects_malformed_json` ("settings"), `Parse_rejects_schema_version_2` ("schemaVersion"), `Parse_rejects_unknown_template` ("template"), `Parse_rejects_four_colors` and `Parse_rejects_bad_hex` ("palette"), `Parse_rejects_missing_roles` ("roles"), `Parse_rejects_role_with_path` (`"../x.glb"`, `"a/b.glb"`) and `Parse_rejects_role_not_glb` ("roles.hero"), `Parse_rejects_speed_0` and `Parse_rejects_speed_21` ("speed"), `Parse_rejects_jumpHeight_1` ("jumpHeight"), `Parse_rejects_spacing_3` ("obstacleSpacing").
  - `Parse_accepts_range_limits`: speed 1 and 20, jumpHeight 1.5 and 5, spacing 4 and 40 are `Ok`.
- [ ] **Step 2: Run** `tools/run-tests.ps1 -Platform EditMode`. Expected: the new tests fail to compile or fail.
- [ ] **Step 3: Implement `SettingsParser.Parse`** with `JsonUtility`. Because `JsonUtility` fills missing fields with defaults, validate `roles` and `palette` for null and the numbers by range. Role names must match `^[A-Za-z0-9_-]+\.glb$` (case-insensitive extension); palette entries must match `^#[0-9a-fA-F]{6}$`.
- [ ] **Step 4: Run again.** Expected: `EditMode: <n> passed, 0 failed`.
- [ ] **Step 5: Commit** `feat: settings schema v1 parser and fixtures`.

---

### Task 3: Runner simulation

**Files:** Create `Assets/Runner/Runtime/Sim/RunnerSim.cs`. Test: `Assets/Runner/Tests/EditMode/RunnerSimTests.cs`.

**Interfaces:**
- Consumes: `Tuning` from Task 2.
- Produces: `enum EntityKind { Obstacle, Collectible }`; `struct Entity { EntityKind Kind; float Z; bool Active; }`; `sealed class RunnerSim` with `RunnerSim(Tuning t)`, `void Tick(float dt, bool jump)`, `void Restart()`, and read-only `float Z`, `float HeroY`, `bool Grounded`, `int Score`, `bool GameOver`, `IReadOnlyList<Entity> Entities` (active or not, from 5 m behind the hero to 60 m ahead). Constants: `Gravity = 30f`, `ObstacleHeight = 1f`, `HitHalfWidth = 0.8f`, `FirstSpawnZ = 20f`, `MaxDt = 0.05f`.

Rules: the hero advances `speed` m/s. A jump sets upward velocity `sqrt(2 * Gravity * jumpHeight)` and is ignored unless `Grounded`. The hero dies when an obstacle has `|Z - e.Z| < HitHalfWidth` and `HeroY < ObstacleHeight`. A collectible with `|Z - e.Z| < HitHalfWidth` becomes inactive and adds 1 to `Score`. `Tick` uses `min(dt, MaxDt)` and does nothing after `GameOver`.

- [ ] **Step 1: Write the failing tests** (default tuning 6 / 2.2 / 12 unless stated; step 1/120 s):
  - `Moves_forward_at_tuning_speed`: after 1 s, `Z` is within 0.01 of 6.
  - `Jump_apex_equals_jumpHeight`: highest `HeroY` is within 0.05 of 2.2; `Grounded` again and `HeroY == 0` within 2 s.
  - `Jump_in_air_is_ignored`: a second jump press 0.2 s after the first leaves the apex at most 2.25.
  - `Large_dt_is_clamped`: `Tick(10f, false)` from the start gives `Z` within 1e-4 of `6 * 0.05`.
  - `Obstacles_are_spaced_by_obstacleSpacing`: the first obstacle is at `Z == 20`; the next at `32`, then `44`. Collectibles sit at 26, 38, 50.
  - `Running_into_obstacle_ends_game`: with no jumps, `GameOver` is true while `Z` is in `[19.2, 20.8]`.
  - `Jumping_over_obstacle_survives`: jump when `Z >= 20 - 6 * sqrt(2 * 2.2 / 30)`; `GameOver` is false once `Z > 22`.
  - `Collecting_increments_score_and_deactivates`: after that jump, once `Z > 27`: `Score == 1` and the collectible at 26 has `Active == false`.
  - `GameOver_freezes_and_Restart_resets`: after game over `Tick(1f, false)` leaves `Z` unchanged; `Restart()` gives `Z == 0`, `Score == 0`, `!GameOver`.
  - `Bot_survives_two_minutes_at_defaults`: a bot that jumps when the next obstacle is within `6 * sqrt(2 * 2.2 / 30)` metres survives 120 s, and `Entities.Count <= 20` throughout.
  - `Extreme_valid_tuning_never_produces_NaN`: speed 20, jumpHeight 1.5, spacing 4 for 10 s: `Z`, `HeroY` are finite.
- [ ] **Step 2: Run EditMode tests.** Expected: the new tests fail.
- [ ] **Step 3: Implement `RunnerSim`** with fixed-pattern lazy spawning and removal of entities more than 5 m behind the hero. No `UnityEngine` types are needed.
- [ ] **Step 4: Run EditMode tests.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: deterministic runner simulation`.

---

### Task 4: URL and model-fit helpers

**Files:** Create `Assets/Runner/Runtime/Loading/UrlTools.cs`, `ModelFit.cs`. Test: `Assets/Runner/Tests/EditMode/LoadingHelperTests.cs`.

**Interfaces:**
- Produces:
  - `static bool UrlTools.TryGetQueryParam(string url, string key, out string value)` (decoded; false when absent or empty; ignores a `#fragment`).
  - `static string UrlTools.ToAbsolute(string pageUrl, string urlOrRelative)`.
  - `static string UrlTools.SiblingUrl(string settingsUrl, string fileName)` (same folder, query and fragment dropped).
  - `static (float scale, Vector3 offset) ModelFit.Compute(Bounds bounds, float targetHeight)`; throws `ArgumentException` when `bounds.size.y <= 1e-4f`. Applying `scale` then adding `offset` puts the base centre at the origin.

- [ ] **Step 1: Write the failing tests:**
  - `Query_param_is_decoded`: `TryGetQueryParam("https://h/index.html?settings=runs%2Fabc%2Fsettings.json&debug=1", "settings", ...)` returns `runs/abc/settings.json`; `debug` returns `1`.
  - `Query_param_missing_or_empty_is_false`: `?settings=` and no query both return false; a `#settings=x` fragment returns false.
  - `ToAbsolute_resolves_relative_against_page`: (`https://h/p/index.html?settings=x`, `runs/a/settings.json`) gives `https://h/p/runs/a/settings.json`; an absolute URL is unchanged.
  - `Sibling_url_replaces_file_and_drops_query`: (`https://h/runs/abc/settings.json?v=2`, `hero.glb`) gives `https://h/runs/abc/hero.glb`.
  - `ModelFit_scales_to_target_height`: bounds centre (1,2,3), size (2,4,2), target 1 gives scale 0.25 and offset (-0.25, 0, -0.75) within 1e-5.
  - `ModelFit_rejects_flat_model`: size.y of 0 throws `ArgumentException`.
- [ ] **Step 2: Run EditMode tests.** Expected: fail.
- [ ] **Step 3: Implement both classes** (`System.Uri` for URL handling, `Uri.UnescapeDataString` for decoding).
- [ ] **Step 4: Run EditMode tests.** Expected: all pass.
- [ ] **Step 5: Commit** `feat: url and model-fit helpers`.

---

### Task 5: Sample content, loader, bootstrap and view

**Files:** Create `tools/make-sample.ps1`, `Assets/Runner/Runtime/Loading/AssetLoader.cs`, `View/RunnerBootstrap.cs`, `View/RunnerView.cs`, `View/Hud.cs`, `Assets/Scenes/Main.unity` (one GameObject holding `RunnerBootstrap`, generated by the build script in Task 6 if absent), `Assets/Runner/Tests/PlayMode/BootstrapTests.cs`.

**Interfaces:**
- Consumes: `SettingsParser`, `RunnerSim`, `UrlTools`, `ModelFit`.
- Produces: `static Task<string> AssetLoader.FetchText(string url)`; `static Task<GameObject> AssetLoader.LoadModel(string url, Transform parent)`; both throw `LoadException(string message)` on any failure and give up after 30 s of unscaled time (frame-based). `RunnerBootstrap : MonoBehaviour` with `enum BootState { Loading, Ready, Failed }`, `BootState State`, `string Error`, `RunnerSim Sim`, and the test hook `string SettingsUrlOverride`.

Behavior: the settings URL comes from the `settings` page parameter, made absolute. If absent: in the Editor use `StreamingAssets/sample/settings.json`; in a player build fail with "No game settings were given. Open this page with ?settings=<url>". After parsing, load hero, obstacle and collectible in that order; fit them to heights 1.0, 1.0 and 0.5; failures read `<role> (<file>): <cause>`. The hero instance is a GameObject named `Hero`. Palette use: `palette[0]` background, `[1]` ground, `[2]` game-over panel, `[4]` score text. The camera follows from 7 m behind and 3 m up. Pre-create 8 obstacle and 8 collectible instances and recycle them. One press (`Pointer.current.press.wasPressedThisFrame`, which covers mouse, touch and pen) or `Space` means jump; after game over, a press restarts. With `debug=1` the HUD shows smoothed fps. Errors are drawn full-screen in white on dark red.

- [ ] **Step 1: Write `tools/make-sample.ps1`.** It writes three box GLBs (no textures; a single material each): `hero.glb` 1 x 1 x 1 base colour `#3a86ff`, `obstacle.glb` 1 x 1 x 1 `#ff595e`, `coin.glb` 0.5 x 0.5 x 0.5 `#ffd166`; copies `fixtures/settings/valid.json` to `settings.json`; and into `Assets/StreamingAssets/sample/`. It also writes `sample-broken/` with the same `settings.json`, a zero-byte `hero.glb` and good obstacle and coin files. Run it and check: `Get-Content Assets/StreamingAssets/sample/hero.glb -Encoding Byte -TotalCount 8` prints `103 108 84 70 2 0 0 0` (`glTF`, version 2).
- [ ] **Step 2: Write the failing PlayMode tests** (`BootstrapTests`, each creates a GameObject with `RunnerBootstrap`, sets the override, and waits up to 600 frames for `State != Loading`):
  - `Sample_loads_and_runs`: `State == Ready`; an object named `Hero` exists; after 60 more frames `Sim.Z > 0`; no error logs.
  - `Missing_settings_url_fails_visibly`: override `missing/settings.json` gives `Failed` and `Error.Contains("settings")`.
  - `Corrupt_role_file_fails_naming_the_role`: override the `sample-broken` settings gives `Failed`, `Error.Contains("hero")`, and no `Hero` object.
  - The failure tests set `LogAssert.ignoreFailingMessages = true`.
- [ ] **Step 3: Run** `tools/run-tests.ps1 -Platform PlayMode`. Expected: fail. If glTFast needs a graphics device, drop `-nographics` from `run-tests.ps1` for PlayMode only.
- [ ] **Step 4: Implement `AssetLoader`** (`UnityWebRequest` for text; `GltfImport.Load` then `InstantiateMainSceneAsync` for models; no threads or timers).
- [ ] **Step 5: Implement `RunnerBootstrap`, `RunnerView`, `Hud`** to the behavior above. `RunnerView.Sync(RunnerSim)` is called every frame; `RunnerBootstrap.Update` feeds `Time.deltaTime` and the jump press into `Sim.Tick`.
- [ ] **Step 6: Run PlayMode and EditMode tests.** Expected: `PlayMode: 3 passed, 0 failed` and all EditMode tests still pass.
- [ ] **Step 7: Commit** `feat: runner bootstrap, loader, view and sample content`.

---

### Task 6: WebGL builds, local server and verification

**Files:** Create `Assets/Runner/Editor/BuildScript.cs`, `tools/serve.ps1`, `docs/superpowers/notes/slice1-results.md`.

**Interfaces:**
- Produces: `static void Runner.EditorTools.BuildScript.BuildWebGL()` (invoked with `-executeMethod`). It creates `Assets/Scenes/Main.unity` if missing and builds `Builds/runner-desktop` (DXT) and `Builds/runner-mobile` (ASTC) with Brotli, Decompression Fallback on and disk-size code optimization, writes `Builds/size-report.json` (`{"desktopBytes":n,"mobileBytes":n}`), and exits with code 1 if either exceeds 15,000,000 bytes. `tools/serve.ps1 -Root <dir> [-Port 8080] [-Lan]` serves files with correct MIME types for `.wasm`, `.js`, `.json`, `.glb` and Unity's data files; `-Lan` listens on all interfaces and needs an administrator shell.

- [ ] **Step 1: Write `BuildScript.BuildWebGL`** to the interface above. Run (PowerShell): `$unity = powershell -File tools/check-env.ps1 -PrintPath` then `& $unity -batchmode -nographics -quit -projectPath unity/runner-template -executeMethod Runner.EditorTools.BuildScript.BuildWebGL -logFile Builds/build.log`. Expected: exit code 0, both build folders exist, `size-report.json` is present.
- [ ] **Step 2: Write `tools/serve.ps1`** with `System.Net.HttpListener` (works without Node or Python).
- [ ] **Step 3: Desktop check in the built-in browser.** Copy `Assets/StreamingAssets/sample/*` to `Builds/runner-desktop/runs/test/`. Serve `Builds/runner-desktop`. Open `http://localhost:8080/index.html?settings=runs/test/settings.json&debug=1`. Expected within 10 s: background `#1b1f3b`, a blue box hero, red box obstacles ahead, yellow collectibles; no console errors; fps shown at 55 or more; one click makes one jump; running into an obstacle shows "Game over" and a click restarts. Models must not be magenta or black. If they are, add the glTFast shaders to Project Settings, Graphics, Always Included Shaders, rebuild, and re-check.
- [ ] **Step 4: Failure checks in the same browser.** Open the page with no `settings` parameter, then with `?settings=runs/nope.json`, then after pointing a role at a missing file. Expected each time: a full-screen message naming the cause, not a blank canvas.
- [ ] **Step 5: Phone check (you).** Run `tools/serve.ps1 -Root Builds/runner-mobile -Lan` as administrator, copy the sample into `runs/test/`, and open `http://<pc-address>:8080/index.html?settings=runs/test/settings.json&debug=1` on a phone on the same Wi-Fi. Expected: loads, one tap is one jump, fps of 30 or more for 60 s. Note the device, browser and iOS or Android version.
- [ ] **Step 6: Write `docs/superpowers/notes/slice1-results.md`:** desktop and mobile build sizes from `size-report.json`, load time, fps and device from the phone check, and any problems found. If a build is over budget or fps is under 30, say so plainly and list the likeliest fixes (fewer glTFast optional modules, lower texture sizes, simpler lighting).
- [ ] **Step 7: Commit** `feat: webgl builds, local server and slice 1 results`.
