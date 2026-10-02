# Slice 1 results: the Unity runner template (2026-10-02)

The template builds for WebGL, loads a `settings.json` plus three GLB files at runtime, and runs in the browser.
**One check is still open: the phone check needs a person with a phone** (see the end).

## Build sizes (budget 15,000,000 bytes each)

| Build | Bytes | Of which |
|---|---|---|
| `Builds/runner-desktop` (DXT) | 7,745,058 | wasm 6,148,176, data 1,379,546, framework 71,750, loader 117,894 |
| `Builds/runner-mobile` (ASTC) | 7,748,865 | wasm 6,148,176, data 1,383,357, framework 71,750, loader 117,894 |

Both are about half the budget. `runs/` (per-game content copied in for testing) is not counted. The two builds are
almost the same size because the template has no textures of its own yet; only the Unity splash logo differs by format.

## What was checked, and how

All of this ran against the final builds, served by `tools/serve.ps1` on a fresh port (so an empty browser cache),
in the built-in browser of the Claude desktop app.

| Check | Result |
|---|---|
| Colours | Background `#1b1f3b`, blue box hero, red obstacles, coral ground (`#ff6f59`, the palette's second colour). Nothing magenta or black. |
| Console | No errors and no warnings from the game (WebGL `getInternalformatParameter` warnings come from the browser's own driver). |
| Frame rate | 81 to 90 fps on the desktop build while the pane was visible. |
| Load time | Cold: about 8 s from the page request to the first model request (almost all of it compiling the 6 MB wasm). Warm, with the wasm cached: under 1 s. |
| Click | One click is one jump; a click on the Game over panel restarts the run with the hero on the ground. |
| Obstacle | Running into the first obstacle shows "Game over / Tap to restart". |
| No `settings` parameter | Full-screen message: "No game settings were given. Open this page with ?settings=<url>". |
| `?settings=runs/nope.json` | Full-screen message: "settings (…/runs/nope.json): HTTP 404". |
| Settings that are not JSON | Full-screen message: "settings: not valid JSON (…)". |
| Role file missing | Full-screen message: "obstacle (ghost.glb): is not a valid GLB file". |
| Role file empty (corrupt) | Full-screen message: "hero (hero.glb): is not a valid GLB file", and the game does not start. |
| Mobile build in a desktop browser | Loads and runs with no console errors. This says nothing about a phone's GPU. |

Tests at the last run: EditMode 61 passed, PlayMode 4 passed.

**Caveat on the fps and click checks.** Partway through, the app hid its browser pane, and a hidden page gets no
`requestAnimationFrame`. For the later checks (restart, failure messages, mobile load) I replaced the page's
`requestAnimationFrame` with a message-channel loop at about 60 Hz. That changes the test harness, not the game, but
it means the fps readout in those runs is capped near 60 and is not a measurement.

## Problems found, and what fixed them

1. **Models and ground rendered magenta, the first frame took 50 to 75 s, and the console filled with "missing script"
   and "serialization layout" errors.** None of it was a shader problem. Unity's build backend (Bee) keeps the list of
   files to bundle into the data file in `Library/Bee/artifacts/csharpactions/webgl.data_*.info`, and it did not
   rewrite that list when only the texture subtarget changed. Every "desktop" build after the 07:19 mobile build
   therefore bundled the mobile build's data: ASTC textures, scripts of the URP package that had since been removed, and
   no `Runner/Flat` shader (so the models had none, hence magenta). The player data was proven stale by hash: the served
   `data.unity3d` was byte-identical to `Library/PlayerDataCache/WebGL4/Data/data.unity3d`, while the correct 460 KB
   data sat unused in `WebGL1`. `BuildScript` now deletes the list before each build and fails the build if the list
   afterwards does not name the requested subtarget's cache. After the fix: data file 3.6 MB to 1.4 MB, desktop build
   9.97 MB to 7.74 MB, first request of `settings.json` 64 s to 8 s after the page request.
2. **The 30 s timeout fired wrongly.** `AssetLoader` measured it with `Time.unscaledTime`, which is cached per frame,
   so one frozen first frame counted as 30 s. A new `FrameTimeout` class adds at most 0.25 s per frame (5 EditMode
   tests, written first) and both `FetchText` and `LoadModel` use it.
3. **The size report counted `runs/`.** `SizeOf` now skips it.

## Fixed after the final review

A fresh reviewer read the whole branch (no Critical issues, verdict "with fixes"). Fixed, each test-first:

1. **Settings that parsed but could not be won.** Each tuning value was range-checked on its own, but a slow hero
   with a low jump never stays above an obstacle for its whole 1.6 m hit window, and obstacles closer together than
   one whole jump drift the timing until a window is missed. The old minimum fixture (speed 1, jump 1.5, spacing 4)
   was one of them. `Winnability.Check` now rejects these with a message naming the value to change; the rule is
   in the spec. Tests: the brute-force count of take-off frames at 120 Hz agrees with the formula, and a bot that is
   0.08 s early or late survives 30 s at every tuning the rule accepts, out of a grid of 912 (19 speeds, 8 jump
   heights, 6 spacings). (My first spacing rule was too
   weak; the bot died on speed 4, jump 4, spacing 4, and the rule was tightened.)
2. **A root-relative `settings` URL** (`/runs/a/settings.json`) would become `file:///runs/a/settings.json` in the
   WebGL player, because Mono's `Uri.TryCreate` treats it as absolute where the path separator is `/`.
   `UrlTools.ToAbsolute` now resolves against the page first. The test pins the result but cannot fail on Windows.
3. **Fitting by height alone** made a thin disc coin 5 m wide and a long model longer than the hit window.
   `ModelFit.Compute` takes a footprint cap, and the template passes the 1.6 m hit width.
4. **The phone check could not detect a double input**; it now has hold-and-release and tap-to-restart steps.

## Review findings not fixed (follow-ups)

- **Hardening for untrusted GLBs and URLs** (do this before the player is public): glTFast fetches any external
  `buffers` or `images` URI inside a GLB, there is no size cap, a timed-out load is not cancelled, and cameras and
  lights inside a GLB are instantiated into every clone. One small `IDownloadProvider` that allows only the role URL
  and caps its size, plus an instantiation mask of mesh and animation only, covers most of it. The `settings` URL
  is also not restricted to the page's own origin, so anyone could link a public player to their own models.
  glTFast's `CollectingLogger` would also turn the misleading missing-file message into the real HTTP error.
- Restart on the first tap after dying hides the "Game over" panel from a player who keeps tapping; a lockout of
  about 0.5 s is usual. Decide it with the phone result.
- One time budget for the whole boot instead of 30 s per request (four requests can show "Loading" for 2 minutes).
- The settings regexes accept a trailing newline (.NET's `$` matches before a final line feed); use `\z`, so they
  agree with the JavaScript validator of the shared contract.
- The pool size copies `RunnerSim`'s look-ahead as a constant and drops entities silently if it runs out.
- `BuildScript` rewrites the tracked `Main.unity` (new file IDs) on every build; create it only if missing, or
  git-ignore it. `EditorBuildSettings.asset` still lists the deleted `SampleScene.unity`, and `Assets/Resources.meta`
  is tracked for an empty folder.
- `Missing_settings_url_fails_visibly` only asserts the word "settings"; assert the cause.
- `serve.ps1` sends `Content-Encoding: br` even when the browser did not offer `br` (plain-HTTP LAN).

## Left over, not fixed

- A role file that does not exist (404) is reported as "is not a valid GLB file", the same as a corrupt one, because
  glTFast's `Load` only returns false. The message names the role and the file, but not the real cause.
- `ProjectSettings/URPProjectSettings.asset` is an orphan from the removed URP package. It is Editor-only and does not
  reach the player.
- The performance-testing package writes `Assets/Resources/PerformanceTestRun*.json` into every build (about 3 KB).
- The Unity splash screen is still in the build; `SplashScreen.show = false` is not honoured on Personal here.
- Unity plans to deprecate the built-in render pipeline the template now uses; `RunnerFlat.shader` is about 20 lines to
  port back to URP.

## Still open: the phone check (plan Task 6, Step 5)

I cannot do this one. It needs a phone on the same Wi-Fi and an administrator shell.

1. In an **administrator** PowerShell, from the repository root:
   `powershell -NoProfile -ExecutionPolicy Bypass -File tools\serve.ps1 -Root Builds\runner-mobile -Lan`
   (Windows may ask to allow the firewall.)
2. `Builds\runner-mobile\runs\test` already holds the sample. Find the PC's address with `ipconfig`.
3. On the phone open `http://<pc-address>:8080/index.html?settings=runs/test/settings.json&debug=1`.
4. Expected: it loads, one tap is one jump, and the fps shown stays at 30 or more for 60 s.
5. Two more checks, because a short tap cannot show a double input: **press and hold for a full second, then release**
   (expected: one jump, not a second one on release), and **tap the "Game over" panel** (expected: the run restarts and
   the hero stays on the ground, with no jump straight away). If either fails, ignore mouse presses for about 500 ms
   after a touch.
6. If the fps is under 30, try `config.devicePixelRatio = 1` in the WebGL template's `index.html` (it is commented out
   by default); rendering at the phone's full pixel ratio is the usual cause of low mobile fps.
7. Write down the phone, the browser and the iOS or Android version here.

Phone result: _not yet run_.
