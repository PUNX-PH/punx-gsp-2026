# Slice 6 handoff: built models, built environments and the High quality tier (written 2026-10-06)

Read this after `slice5-handoff.md`. It says where slice 6 stands, what only the studio can do, and how to continue. The authorities are the
spec `docs/superpowers/specs/2026-10-06-built-models-design.md` (amended with the High quality tier) and the plan
`docs/superpowers/plans/2026-10-06-slice6-built-models.md` (48 tasks, executed inline, as the user chose).

## Progress at a glance (2026-10-06)

| Part of the plan | State |
|---|---|
| Tasks 1 to 21: recipes, the Blender builder, Build Model, its panel, card and starter | Done and tested; on `main` |
| Tasks 22 to 27: the Claude designer, caches, designs and motions | Done and tested; on `main` |
| Tasks 28 to 34: scenery, the environment wire, Build Environment, the scenery in Unity | Done and tested; on `main` (Unity tests last run at Task 21) |
| Task 35: rebuild and publish the template | **Waiting on the Unity Hub sign-in** |
| Tasks 36 to 41: the High tier (kit, builders for every kind and the world, the Quality setting, the settings contract) | Done and tested; **local, not pushed before this note** |
| Tasks 42 and 43: Unity's lit look, the High world, instancing, the quality governor, the budget tests | Written and compiled, pure parts run on a stand-in; **no Unity run** |
| Task 44: rebuild, publish and measure (a phone) | **Waiting on the Unity Hub sign-in** |
| Task 45: the Stage 6 gate | Web, worker and Blender green; Unity not run |
| Task 46: the whole-branch review | **Not done** (stopped before it reported) |
| Task 47: this handoff | Done |
| Task 48: live acceptance | **The studio's**, after the steps below |

## What this slice is

Two new steps on the canvas. Both turn words into game assets by writing a **recipe** (data, never code) and having the private Blender worker
build it; both run only inside Play, and both work with **no AI at all** when a kind is chosen and the words are empty.

- **Build Model** makes a hero, an obstacle or a collectible. The creator picks a role and a kind (biped, vehicle, blob, prop, or Auto, where Claude
  picks), describes it, and, for a hero, writes the **Run** and **Jump** motions in their own boxes (an obstacle or collectible has one **Loop** box).
  Rigid parts are joined into one mesh per joint and animated by node tracks (no skin), so the file is small and plays the same in Unity's WebGL
  player. The Jump clip is played in step with the jump.
- **Build Environment** makes the world's look from a theme: a sky color, a field color, a stripe color, a density (few, some, lots) and up to
  three scenery pieces (tree, pine, rock, cactus, windmill, lamp) that Unity recycles on both sides of the road. An empty theme builds the default
  "meadow".
- **Quality: Standard or High**, a setting on both steps (Standard is the default, and a Standard game is byte-for-byte what it was). High adds
  finishes (metal, glow, matte, glass), bevels, details (seams, bolts, cables, lights), vertex-colour cavity shading, and, in Build Environment, a
  **world**: terrain (desert dunes or meadow hills), a road with edge lines and dashes, and a ring of distant mesas or domes. Unity then draws a lit
  look (sky with a sun, a soft contact shadow, fog) with instanced clones, and a **quality governor** steps the game's own detail down on a slow device.
  High is only built when the creator asks for it.
- A starter, **New: build a character**, wires Build Model, Build Environment, Game Template and Preview so the first Play works with no words.

## Where it stands

- Branch `slice-6-built-models`. `main`, `origin/main` and `origin/slice-6-built-models` are all at `90e8c0e`: that holds Tasks 1 to 34 (Build
  Model, the designer, Build Environment, the scenery in Unity) and the High kit and both recipe checks (the start of Task 36), so the site on Vercel
  already has the Standard steps. **Everything after it (Tasks 36's builders, 37 to 43, the not-set-up message, the docs, the tools and this note) is
  local and not pushed.** Ask before any push (the repo is public; pushing `main` starts a production build).
- **Plan tasks 1 to 34 and 36 to 43 are done, with their tests, on this branch.** Not done: Task 35 and Task 44 (they need Unity to build and publish
  the template, and a phone), Task 48 (live acceptance, the studio's). So **the published Unity template is still the one from before this slice**:
  a built game cannot play in the live Preview until Task 44 publishes the rebuilt template. The whole-branch review (Task 46) is NOT done; see
  "The final review".
- **Unity could not be run for Tasks 33, 34 and 42 to 44:** the Unity Hub sign-in lapsed (the batch run exits 198, "No valid Unity Editor license
  found"). Tasks 1 to 32 were last run with Unity at Task 21 (EditMode 82 and PlayMode 9 green). Everything written since is **compiled** against
  Unity's own reference assemblies (`compile-runtime.sh` with the rsp files) and the pure parts are **run** on a .NET stand-in with a real NUnit,
  but no shader has been compiled, no PlayMode test has run, and the template has not been rebuilt or published. See "Unproven until it is live".
- **The gate** (2026-10-06): web 1846 tests in 88 files, lint, `tsc` and `npm run build` clean with no AI or Blender variable set; the worker's
  wrapper 59 tests (`npm --prefix blender-worker test`); the Blender file on Blender 5.2.2 (`blender-worker/tests/test_blender.py`, 66 tests, about 8 minutes);
  mutation checks of the budget order, the estimate, the cache key, the mesh rule, the look and Game Template's lit switch all failed the tests as
  they should and were restored by hash.

## What was built (where to look)

```
blender-worker/        recipe.mjs (the worker's recipe checks, the same rules as the web's), server.mjs (POST /build and the headers),
                       scripts/{build.py, high.py, world.py, common.py, kit.json}, tests/, fixtures/recipes/ (+ high/), tools/ (the generators)
web/src/lib/builder/   kinds.ts (the kit, typed), recipes.ts (the checks), repair.ts (what Claude's output is fixed to), keys.ts (cache keys),
                       service.ts (the rules: designs, motions, environments, limits, caches), server.ts (wiring), types.ts, memory.ts, firebase.ts
web/src/lib/ai/        designPrompts.ts (the three prompts and schemas, built from the kit), designer.ts, anthropic.ts (askForJson)
web/src/lib/graph/     nodes/{buildModel,buildEnvironment}.ts, registry.ts (specs, the quality setting), types.ts (the wire types), nodes/gameTemplate.ts
web/src/lib/settings.ts  the settings file contract (look, environment.world), shared fixtures in web/src/lib/fixtures/settings
web/src/app/graphs/[id]/  SettingsPanel.tsx (Build Model and Build Environment panels, the Quality group), StepCardView.tsx
unity/runner-template/Assets/Runner/
  Runtime/Settings/    GameSettings, SettingsParser, JsonKeys (look and world read from the raw text)
  Runtime/View/        RunnerBootstrap, EnvironmentView, SceneryLayout, WorldPlacement, WorldLook, WorldView, Hud
  Runtime/Loading/     LitMaterialGenerator (instancing on), Runtime/Quality/ (QualityGovernor, QualityLevels)
  Shaders/             RunnerLit, RunnerSky, RunnerBlobShadow (never compiled in Unity)
  Tests/               EditMode and PlayMode, StreamingAssets/sample-built, sample-world, sample-world-high, sample-world-missing
```

The kit exists once, in `blender-worker/scripts/kit.json`, and again typed in `web/src/lib/builder/kinds.ts`; a test keeps the two equal. **A kit
change is made with `blender-worker/tools/` (below), never by hand in one place.**

## Decisions and rulings worth keeping

- **Data, never code.** Claude returns a recipe in a fixed JSON schema (structured outputs); the web app repairs it (clamps, drops unknown parts) and
  the worker **repeats every check** on its side, so a hostile prompt can at worst make a small, bounded model. Shared fixtures keep both sides equal.
- **Cache keys.** A Standard key is the same list byte for byte as before the High tier; **a High key appends `"high"`**. Bump `RECIPE_VERSION`
  (`web/src/lib/builder/keys.ts`) when a prompt or a repair changes what the same words give, and the build's `JOB_VERSION`
  (`web/src/lib/blender/key.ts`) when a Blender script or the worker's output changes. A cache record whose file is gone is a miss; a stored High job
  with no vertex count is a miss.
- **Limits.** Claude calls and Blender jobs are counted **before** the call and **given back** when the service did not answer or its result could not
  be used; they are kept when the model refused the request or Blender ran and refused the recipe. A motion edit asks Claude only for the changed
  clips and keeps the look.
- **The worker refuses what the budgets forbid.** The kit's caps per kind (triangles, vertices, parts, meshes), the mesh rule (1 + each non-root joint
  with a track, so a biped's motions fit 14 meshes), and, in High, the real counts of the exported GLB within 10 percent of the kit's estimate. A High
  build that is over its caps drops details in a fixed order (cables, bolts, seams, lights, then extras from the end, then the bevel) until it fits.
- **High numbers are measured, not guessed** (`kit.json` `tiers.high`; `tools/measure-high.py`). The world's pieces: terrain 2 m grid, 160 by 100 m,
  4131 vertices and 8000 triangles; road 595 and 868; backdrop 612 and 408 (the larger of the two styles, which is the bound the kit states).
- **The three-tile world.** Two terrain tiles cannot cover the 200 m the game shows (30 behind the hero, 170 ahead), so there are **three** tiles of
  100 m that follow the hero by whole tiles. The visible-triangle budget test holds with all three in view.
- **Vertex colours.** Cavity shading is written to `COLOR_0` with `export_vertex_color="NAME"`; it is VEC4 normalized ushort in the GLB, and Unity's
  loader reads that. Never call `recalc_face_normals` on an open surface (it flips it).
- **No `CreatePrimitive` in the template.** The template builds its meshes in code, so a player build without the physics module still works.
- **`look` and `environment.world` are read from the raw settings text** (`JsonKeys`), because `JsonUtility`'s behaviour on a wrong-typed value is not
  known; both sides give the same messages (see the shared fixtures).
- **Not set up is not "did not answer".** A site with no `BLENDER_WORKER_URL` or `BLENDER_WORKER_KEY` says "The Blender service is not set up on this
  site yet." and gives the count back; an old or private-and-refusing worker says "did not answer".
- **No Describe Game choosing shapes, no skinned characters, no compression library.** A compressed GLB would be a new dependency and the studio's
  call; it is needed only if the first real High load is over 15 seconds.

## Unproven until it is live

Only the live site, a Unity run and a phone can show these:

- **Unity**: the three shaders compile and render (`RunnerLit`, `RunnerSky`, `RunnerBlobShadow`); the `.meta` files of every new Unity file
  (shaders, `WorldPlacement`, `WorldLook`, `WorldView`, `LitMaterialGenerator`, `JsonKeys`, `Quality*`, `SceneryLayout`, `EnvironmentView`, the
  tests, `sample-world`, `sample-world-high`, `sample-world-missing`) have to be generated by a Unity run and committed with the files; the
  EditMode and PlayMode tests (the renderer count of `sample-world-high` is expected to be at most 100); `RUNNER ready in N ms` with the High sample.
- **The template** has to be rebuilt and published with Unity (Task 44) before any of this reaches the site; the published player is still slice 1's.
- **The real `/build` on Cloud Run** with the redeployed worker (Standard and High), Blender's time per High build, the cold start.
- **The real Claude calls**: that the Auto schema (`{ design: anyOf[...] }`) is accepted by the API (a 400 "schema" error would mean it needs another
  form), the cost of one design, one motion and one environment, and the quality of what Claude writes for the kit.
- **The Firestore caches** (`builderDesigns`, `builderMotions`, `builderEnvironments`) and the usage counters, first exercised on the deployment.
- **The phone**: 30 frames per second or more on a real phone, and the governor's level reached (the HUD shows "N fps, quality L" with `debug=1`).
- **Play's time** on a cold first Play of a full game (hero, obstacle, collectible and an environment), and whether a second Play was needed.
- **Visual judgement by eye**: the lit look, the finishes, the desert and meadow worlds, the blob shadow, the scenery against the field.

## Blocked on the studio (do these once, in order; I ask before each)

1. **Unity Hub sign-in** on the development machine (so the licence is valid), then I run the EditMode and PlayMode suites, generate and commit the
   `.meta` files, rebuild the WebGL template, measure `RUNNER ready in N ms` and the frame rate, and publish the template (Tasks 35 and 44).
2. **Redeploy the Blender worker from the final code** in Google Cloud Shell (the commands are in `slice5-setup-progress.md`, "Slice 6"; the
   deployed revision today is `main` at `90e8c0e`: Standard only, with no High tier and no mesh check), then run `smoke.mjs` and check its `/build` line.
   Slice 5's open setup (invoker key, `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` Sensitive in Vercel, redeploy, a budget alert) comes first if it
   is still open. Deploys can be automated (a Cloud Build trigger on `main` for `blender-worker/`); the studio has not asked for that yet.
3. **A funded Anthropic key** (a Claude Console workspace with a monthly spend limit): `ANTHROPIC_API_KEY` as a Sensitive Production variable in
   Vercel, then redeploy. Without it the AI half says "did not answer" and nothing is charged; the default models still build.
4. **Push and merge on the user's word** (`slice-6-built-models` into `main`), then wait for the production build.
5. **A phone** on the same Wi-Fi (and an administrator shell for the local server) for the 30 frames per second check.

## The live checks (plan Task 48)

The twelve done-criteria of the spec, in a real browser: (1) signed out, every graph page and API call is refused and the worker's address gives
403; (2) Build Model hero "a red fox in a scarf", Play: kind, parts, triangles and clips on the card, the hero runs on the ground and plays Jump in the
air; (3) change only the Run box (same look, new motion, one new Claude request), then the description (a new look); (4) an obstacle and a collectible
built the same way move; (5) Build Environment "a windy meadow": field, stripes, sky color and scenery on both sides that recycle and never pop; (6) a
chosen kind with every box empty and an empty theme work with no AI call; (7) Play again unchanged says "Reused your earlier result" with no Claude
request and no Cloud Run request; (8) the refusals (Auto with no description; the daily limits with `AI_DAILY_LIMIT_PER_PERSON=1` and
`BLENDER_DAILY_LIMIT_PER_PERSON=1`, redeployed and then **restored**; a wrong worker URL, then restored; a role mismatch; a hostile prompt); (9) the
phone; (10) `git grep` for key material finds nothing, the worker is private, the Claude key exists only in Vercel; (11) **High quality**: kinds
chosen, boxes empty, Quality High on both steps: the game looks lit, the card numbers are within the caps, `RUNNER ready in N ms` is 15,000 or less and
the desktop holds 60 frames per second with `debug=1`, and the phone holds 30 or more with the governor's level noted; (12) a Standard game and an
old settings file play exactly as before. Then measure Play's time (a cold first Play of a full game), and write `slice6-results.md`.

## The final review

**Not done.** The one fresh whole-branch review (plan Task 46) was started on 2026-10-06 and stopped before it reported anything, so **no
independent review of this slice exists yet**; what backs it is the tests, the mutation checks and the gate above. Run it again before the merge to
`main` (a fresh reviewer, read-only, over `main..slice-6-built-models` and the seven Review Focus items in Task 46), fix any Critical or Important
finding test-first with one `fix:` commit each, and list the minors under "Deferred minors". The ledger is
`.superpowers/sdd/2026-10-06-slice6-built-models/progress.md` (git-ignored).

## Regenerating every real-output fixture

All from the repository root, Blender 5.2 at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`, Node 24 on the path. Running any of them
on the committed code changes nothing (that is the check).

- The kit's High numbers and both copies of the kit: `blender-worker/tools/README.md` (measure, edit `tiers-table.mjs`, `node blender-worker/tools/write-tiers.mjs`).
- The High recipe fixtures and `expected-high.json`: `bash blender-worker/tools/regen-high-fixtures.sh`.
- The real GLBs the web tests use (`web/src/lib/blender/fixtures`) and the Unity samples (`sample-built`, `sample-world`, `sample-world-high`): the commands
  are in `blender-worker/README.md` ("The web app's fixtures") and `tools/README.md` step 5.
- The Blender tests: `blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py` (pass test names after `--` to run one).

## Deferred minors

None recorded yet, because the review has not reported. Known loose ends that are not review findings:

1. The Unity compile-check scripts (`compile-runtime.sh` and the rsp files, with the .NET stand-in harness) lived in the session's scratchpad and are
   not in the repository; they have to be rebuilt if Unity still cannot run.
2. The three shaders have never been compiled by Unity, and the `.meta` files of the new Unity files do not exist yet (see "Unproven").
3. Task 35's visual check of the world, and Task 44's measurements, are open until the Unity sign-in.

## How to work here

Same as slices 2 to 5. Node in Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`; run web commands from `web/` and worker commands with
`npm --prefix blender-worker test`; work test-first; ask before any push, install or deploy. Unity batch runs need the Hub sign-in; without it, compile
against Unity's reference assemblies as the ledger describes (`scratchpad/unitycheck` is session-local: rebuild it from the rsp files described in
Task 33's ledger line if needed). The Bash tool turns backslash escapes into real characters: write files with those using the editor tools.
