# Slice 1 handoff (updated 2026-10-02, after the build fix)

Read this first in a new session. It says where Slice 1 (the Unity runner template) stands, what was learned, and
what to do next. The spec and plan are the authority:
`docs/superpowers/specs/2026-10-02-studio-platform-v1-design.md` and
`docs/superpowers/plans/2026-10-02-slice1-unity-runner-template.md`. Measured results are in
`docs/superpowers/notes/slice1-results.md`.

## The product, in one paragraph

A studio website where a creator describes a hypercasual game, adds reference images and assets, and
connects nodes on an n8n-style canvas. **Vercel** serves the node-based frontend. **Blender** (a headless
worker, which cannot run on Vercel) prepares and generates the models. **Unity** is the game engine: the
studio builds a few WebGL templates once, and each game is the template plus a `settings.json` and GLB
files loaded at runtime. No Unity Editor ever runs on a server (Unity's Editor terms, Section 2.1).
The GitHub repo is `PUNX-PH/punx-gsp-2026` (public).

## Where the work stands

- Repo: `C:\dev\GameStudioPlatform` (outside OneDrive on purpose). Branch `slice-1-unity-runner`.
- Plan Tasks 1 to 5 are complete. Task 6 is done except the **phone check**, which needs the user (steps in
  `slice1-results.md`). Tests: EditMode 61, PlayMode 4
  (`powershell -NoProfile -ExecutionPolicy Bypass -File tools/run-tests.ps1 -Platform EditMode|PlayMode`).
- The final whole-branch review is done and its Important findings are fixed (see "Fixed after the final review" in
  `slice1-results.md`). Its Minor findings and the untrusted-input hardening are listed there as follow-ups.
- Both WebGL builds are about 7.7 MB against a 15 MB budget and pass every browser check that can be done
  without a phone: colours, console, jump, game over, restart, and five failure messages.
- The ledger is `.superpowers/sdd/2026-10-02-slice1-unity-runner-template/progress.md` (git-ignored, so it
  is not in the repo).
- Skills are in `.claude/skills` (sources in `.claude/skills-sources/SOURCES.md`). The executing-plans
  skill is the active workflow: final whole-branch review by a fresh reviewer, one fix pass, then
  `finishing-a-development-branch`.

## What was learned (keep)

- Unity 6.3 LTS `6000.3.25f1` plus WebGL module and Hub 3.22.1 are installed at the default paths.
  Blender, Node and Python are not installed. Ask before installing anything.
- **Bee (Unity's build backend) can bundle the wrong data after a texture-subtarget switch.** It does not rewrite
  `Library/Bee/artifacts/csharpactions/webgl.data_*.info` (the list of files to bundle) when only the subtarget
  changes, so a desktop build after a mobile one shipped the mobile build's stale data. `BuildScript.Build` deletes
  that list before each build and throws if it does not name `PlayerDataCache/WebGL<subtarget>/` afterwards. If
  a build ever shows missing scripts, ASTC warnings or deleted packages' shaders, compare the SHA-256 of the
  served `data.unity3d` with the files under `Library/PlayerDataCache/`. (`WebGLTextureSubtarget`: DXT = 1,
  ASTC = 4.)
- Batch builds: pass `-buildTarget WebGL`. Do not use `WasmCodeOptimization.DiskSizeLTO`: it took over
  14 minutes just to link, per target. `DiskSize` is used; a desktop build takes about 5 minutes, a following
  mobile build about 2. `Start-Process -Wait` hangs for about 10 minutes because the Editor leaves a C# compiler
  server running; the scripts wait on the process only. `-nographics` is fine for tests; builds run with a graphics
  device.
- Run PowerShell tools from Git Bash as `powershell -NoProfile -ExecutionPolicy Bypass -File ...`.
  Git on this machine has `core.autocrlf=true`; `.gitattributes` forces LF.
- Test waits must be in real time, not frames: with no graphics a frame takes microseconds.
- Web builds have no timers, and `Time.unscaledTime` is cached per frame: use `FrameTimeout`
  (at most 0.25 s counted per frame) for time limits, not a start-time comparison.
- Unity does not honour `SplashScreen.show = false` on Personal here; the splash texture is still in the build.
- The Unity WebGL loader keeps the data file in the browser cache and needs `ETag` or `Last-Modified` to
  notice a rebuild. `tools/serve.ps1` sends them for build files, sends `Content-Encoding: br` for
  `.unityweb` files (the JavaScript fallback is slow), and sends `no-store` for everything under `runs/`.
  Use a fresh port to get a fresh origin when checking a rebuild.
- glTFast materials: its shader graphs were the first suspect for the magenta. The template now uses one
  tiny shader (`Assets/Runner/Shaders/RunnerFlat.shader`, built-in pipeline, one pass, no keywords) and a
  custom `FlatMaterialGenerator` that tints it with each glTF base colour. A PlayMode test proves the hero
  is `Runner/Flat` and `#3a86ff`. The shader reaches the player through Always Included Shaders (set in
  `BuildScript`), and `RunnerBootstrap` creates the material at runtime. A missing shader is a named error.
  (The magenta itself turned out to be the stale-data bug above, not glTFast.)
- The template was moved off URP to the built-in render pipeline. Reason: URP shipped about 3 MB of unused
  post-processing textures. Unity plans to deprecate the built-in pipeline in a later release; the shader is about
  20 lines to port back.
- Scenes referencing materials made `level0` unreadable in earlier builds (also the stale-data bug); the scene is
  now only the bootstrap object, regenerated by `BuildScript` on every build.
- The built-in browser pane can be hidden by the app; a hidden page gets no `requestAnimationFrame` and the game
  stalls (each screenshot forces one frame). To test anyway, replace `window.requestAnimationFrame` with a
  `MessageChannel` loop right after navigating (see the caveat in `slice1-results.md`).

## Files and tools

- `tools/check-env.ps1` finds Unity and refuses OneDrive paths. `tools/run-tests.ps1`, `tools/make-sample.ps1`
  (sample GLBs, settings, and a corrupt-hero variant), `tools/build-webgl.ps1 -Target desktop|mobile|both|desktop-dev`,
  `tools/serve.ps1 -Root <dir> [-Port 8080] [-Lan]` (serves with the headers above).
- Build output goes to `Builds/` (git-ignored). A build deletes its output folder, so copy
  `Assets/StreamingAssets/sample/*` (not the `.meta` files) into `Builds/runner-<target>/runs/test/` afterwards, then open
  `http://localhost:8080/index.html?settings=runs/test/settings.json&debug=1`.
- Unity project: `unity/runner-template`. Settings contract fixtures: `fixtures/settings`.

## Next steps, in order

1. The user runs the phone check (`slice1-results.md`, last section) and the result goes into that note.
2. `slice-1-unity-runner` is pushed to `PUNX-PH/punx-gsp-2026` (`main` is still the setup commit). Still to decide with
   the user, per `finishing-a-development-branch`: merge to `main`, open a pull request, or keep the branch. Do not
   merge without being asked. GitHub sign-in works through Git Credential Manager. The ledger workspace
   `.superpowers/sdd/2026-10-02-slice1-unity-runner-template/` is kept until the phone check is done.
3. Amend the spec for Vercel hosting (static editor and WebGL builds on Vercel, Blender worker on a separate host,
   `vercel.json` headers for `.unityweb`). **Gate before the player is public:** harden it against untrusted GLBs and
   URLs (a download provider that allows only the role URL and caps its size, a mesh-and-animation-only
   instantiation mask, a same-origin rule for `settings`); this needs a decision on where run folders live.
4. **Next slice: web foundation (slice 2).** Decided with the user (2026-10-02): web first, hosted on Vercel, real
   accounts for `@punx.ai` addresses only (Firebase email-link sign-in), all-Firebase storage (Firestore + Cloud
   Storage, which needs the Blaze plan), Describe Game included but in a later slice. The spec is written and
   committed on branch `slice-2-web-foundation`: `docs/superpowers/specs/2026-10-02-web-foundation-design.md`
   (status: awaiting the user's review). Next: the user reviews the spec, then `writing-plans`, then the user reviews
   the plan and picks an execution method. Nothing is built or installed for it yet (Node.js is not installed; ask).
