# Slice 9: The Art Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, executed **inline ("native")**: one session, **no check-ins**, a ledger at `.superpowers/sdd/2026-10-09-slice9-art-pipeline/progress.md` (git-ignored), then **one fresh whole-branch review** (Task 20)
> and one fix pass. Steps use checkbox (`- [ ]`) syntax. **Ask before any push, install, download or deploy.** Branch `slice-9-art-pipeline` from `main` (after slice 8's branch is merged, or from it if it is not).
> Blender 5.2.2 is installed here (`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`); never run two Unity processes at once. Studio asks: the worker redeploy (Task 19), a phone for the budgets and the look (Tasks 1 and 21).

**Goal:** Models and sprites that look good and fit a per-target triangle budget (PC and Android), 3D or 2D, built from Claude's recipes by an extended Blender builder.

**Architecture:** The recipe kit grows (smooth surfaces, revolve, loft, mirrored limbs, organic blob, PBR materials, procedural textures baked to one atlas, UVs). The worker's `/build` takes a `target` (`pc` or `mobile`) and enforces that target's budgets, then adds LOD meshes; the web builds both targets with two cached calls. A `/sprites` endpoint renders the same model orthographically into a sprite sheet. The run holds `entity-NAME.glb` (PC), `entity-NAME.mobile.glb` and, for 2D, `entity-NAME.sprites.png` and `.json`; the player picks by platform, export keeps only its target's files.

**Tech Stack:** Blender Python (our scripts only), the worker (Node, `node --test`), TypeScript, Vitest, Unity 6000.3.25f1 with glTFast, the packager. No new dependency unless Task 5 measures one is needed.

**Spec:** `docs/superpowers/specs/2026-10-08-art-pipeline-design.md` (approved 2026-10-09).

## Global Constraints

- Budgets (triangles; `kit.json` `tiers`, fixed in Task 1 from measurements, these are the starting values): hero **15,000 PC / 5,000 mobile**; enemy, prop, collectible **5,000 / 1,500**; scenery or world piece **8,000 / 2,500**; all on screen about **250,000 / 80,000**; texture side **2048 / 1024**, textures per model **3 / 2**; materials per model **4 / 3**. LOD1 is 50% and LOD2 15% of the triangles.
- `target` is `pc` or `mobile`; a model's cache key includes it; `JOB_VERSION` is bumped by any change to a Blender script or the worker's output.
- **Data, never code:** recipes in a fixed schema, checked by the web app and again by the worker; Blender runs only our scripts; the worker has no secrets.
- Asset requests gain `style` (realistic, stylized, cartoon, painted, flat), `detail` (hero, prop, background) and `view` (`3d`, `sprite2d`); every schema sent to Claude stays **small** (the API refuses a large one: a 400 "compiled grammar is too large"); detail lives in the prompt and in checks.
- Standard builds keep their meaning and size; High is the first rung of the new pipeline. Old recipes, graphs and runs keep working.
- Sprite sheets: atlas at most 2048 PC and 1024 mobile, frame data as small JSON beside the PNG; metadata also fits in a response header of at most 6 KB (base64).

## Review Focus

1. A recipe that cannot fit its budget: drops detail in the fixed order, then fails plainly; the worker never returns a model over budget. (Tasks 4, 6)
2. A hostile or malformed recipe (unknown part, huge subdivision, UV or texture sizes beyond the caps, a path in a name): refused by the worker as well as the web, with no Blender run on it. (Tasks 2, 3)
3. A mobile variant that loses the silhouette or the bounding box (more than 5%): fails the build, not shipped. (Task 6)
4. An old run or old settings (one GLB per entity): still plays; the player falls back when a `.mobile.glb` or sprite file is missing. (Tasks 13, 15)
5. Worker time: a bake or sprite render that outlasts the job limit: a plain "took too long" and the model is a plain shape, never a hung Play. (Tasks 5, 17, 19)

---

## Milestone A: measure and look (the gate)

### Task 1: Budgets and five reference models
**Files:** Create `blender-worker/tools/measure-art.py`, `blender-worker/tools/render-preview.py`, `blender-worker/fixtures/recipes/art/*.json` (five hand-written recipes: a fox hero, a robot enemy, a wooden crate, a forest scenery piece, a spaceship)
- [ ] Write the five recipes with the current kit's best High settings; build them; render each to a PNG with `render-preview.py` and measure triangles, vertices, file size. Put the pictures in `docs/superpowers/notes/art-gate/` and **show them to the owner**. **Gate:** the owner judges whether the ceiling of the current kit looks good enough; if not, the kit grows in Tasks 2 and 3 until the five do. Record the measured budget numbers in `kit.json` `tiers` (PC and mobile) and ledger them.

## Milestone B: the richer kit

### Task 2: Kit v2 schema, both sides
**Files:** Modify `blender-worker/scripts/kit.json`, `recipe.mjs`, `web/src/lib/builder/kinds.ts`, `recipes.ts`, `repair.ts`, tests; use `blender-worker/tools/write-tiers.mjs` so both copies stay equal
**Produces:** part types `revolve`, `loft`, `mirror`, `blob`; per-part `smooth` (0 to 1), `bevel`, `subdiv` (0 to 2); per-model `materials` (up to 4: `color` slot, `roughness`, `metallic`, `emission`, `texture`: `none|noise|stripes|panels|wear`) and `target`.
- [ ] Tests (web `recipes.test.ts`, worker `recipe.test.mjs`, shared fixtures): every new field's range and refusal; unknown parts dropped by repair and refused by the worker; subdivision caps; the kit-equality test. Implement. Commit.

### Task 3: The builders for the new parts
**Files:** Modify `blender-worker/scripts/build.py`, `common.py`; Create `scripts/parts_v2.py`; tests in `tests/test_blender.py`
- [ ] One test per part: it builds, is manifold where it should be, its triangles are within the estimate, normals are smooth; a seeded blob is deterministic. Implement with bmesh and modifiers (no operators that need a UI). Commit.

### Task 4: Budget enforcement per target
**Files:** Modify `build.py`, `server.mjs`, `recipe.mjs`
- [ ] The body gains `target`; the worker refuses a body over the target's caps, builds, then checks the real counts of the GLB (within the existing tolerance of the estimate); a model over budget drops detail in the fixed order (details, subdivision from the end, bevels, extras) until it fits, else exits 5 `bad-recipe`. Tests: each drop step, the failure, both targets for the same recipe. Commit.

## Milestone C: materials, textures, variants

### Task 5: Materials, UVs, the atlas
- [ ] Materials with PBR values from the palette; procedural textures (noise, stripes, panels, wear, ambient occlusion) baked into one atlas per model at the target's size; smart UV unwrap by our own call. Tests: UVs present and within 0 to 1, atlas size, textures and materials within the caps, a build under the worker's job limit (**measure**; if the cold bake passes 60 s, raise the job limit and the Cloud Run CPU and memory and ledger the numbers). Commit.

### Task 6: The mobile variant and LODs
- [ ] From the PC mesh: decimate to the mobile budget with the silhouette kept, resize textures, merge materials; add LOD1 and LOD2 as separate meshes named `NAME_LOD1`, `NAME_LOD2` in the same GLB. Tests: counts under budget, the bounding box within 5%, LOD ratios, the GLB loads. Commit.

## Milestone D: sprites

### Task 7: The sprite renderer
**Files:** Create `blender-worker/scripts/sprites.py`; Modify `server.mjs`
**Produces:** `POST /sprites` with `{ recipe, motions, palette, views: "side"|"top"|"eight", frames, target }` returning a PNG atlas, with the frame data in `X-Sprite-Meta` (base64 JSON: frame rectangles, pivots, fps, loop flags).
- [ ] Tests: frame count, atlas within the size cap, transparent background, metadata matches the atlas, an oversize request refused. Commit.

## Milestone E: the web side

### Task 8: Recipes, prompts, schemas
- [ ] The design prompts and schemas are built from the kit table and carry `style`, `detail`, `view`; schemas stay under a size test (assert the JSON length, as slice 7's author test does); `RECIPE_VERSION` bumped; repair clamps and drops. Tests as slice 6's. Commit.

### Task 9: The builder builds both targets
**Files:** Modify `web/src/lib/builder/service.ts`, `keys.ts`, `blender/client.ts`, `blender/key.ts`
- [ ] `buildModel` builds the PC and mobile variants as two cached worker calls (keys include `target`), returns both hashes and the counts for the card; limits count both builds (given back on failure); the sprite call for `view: "sprite2d"`. Tests with the fake worker: caching per target, give-back, the clock, both variants stored in the graph folder. Commit.

### Task 10: Settings, cards, Describe Game's assets
- [ ] Build Model and Build Environment gain **Target** (both, PC, Android) next to Quality; the card shows triangles, textures and sizes for each variant; Describe Game's asset requests carry style, detail and view and use the game's targets. Tests. Commit.

### Task 11: Run files and export per target
**Files:** Modify `settings.ts` (`filesNeeded`), `runs/service.ts`, Preview, the export service, `packager/server.mjs`
- [ ] A run's files may be `entity-NAME.glb`, `entity-NAME.mobile.glb`, `entity-NAME.sprites.png`, `entity-NAME.sprites.json` (names and sizes checked, PNG header checked); the export sends only the target's variants (Windows: PC files; Android: mobile files); the packager accepts the new names. Tests, including old runs. Commit.

## Milestone F: Unity

### Task 12: Variant choice and LODs
**Files:** Modify `Runtime/Loading`, `Runtime/Script/ScriptView.cs` or `Runtime/Engine/EngineGame.cs` (whichever of slices 7 and 8 is on `main`), `RunnerBootstrap.cs`
- [ ] Load `.mobile.glb` on a mobile platform (and the mobile WebGL build) and the PC file otherwise, falling back to whichever exists; switch LODs by distance and by the governor level. PlayMode tests with two sample models. Commit.

### Task 13: Sprites
- [ ] Draw a sprite sheet as textured quads with the Flat or an unlit alpha shader; play, loop and pause from the metadata; `2d` cameras use them. Tests (EditMode for the frame math, PlayMode for loading). Commit.

### Task 14: The governor
- [ ] The slice 6 governor also steps down LOD bias, then shadows and fog, then scenery density, in that order, with tests; the HUD debug line shows the level. Commit.

## Milestone G: gates and acceptance

### Task 15 to 18: gates
- [ ] 15: web gate (`vitest`, `tsc`, `eslint`, `npm run build`, packager tests). 16: worker gate (`npm --prefix blender-worker test`, `blender -b --factory-startup --python-exit-code 1 -P blender-worker/tests/test_blender.py`; mutation checks of the budget order, the drop order and the variant ratio). 17: Unity gate (EditMode and PlayMode). 18: handoff `slice9-handoff.md` and `CLAUDE.md`.

### Task 19: Redeploy the worker (the studio's)
- [ ] From a fresh clone of `main` in Cloud Shell: `gcloud run deploy blender-worker ...` with the new CPU, memory and timeout from Task 5, then `smoke.mjs` (extend it with a `/build` for each target and a `/sprites`). Ledger.

### Task 20: Whole-branch review
- [ ] A fresh read-only reviewer over the branch and the Review Focus; fix Critical and Important findings test-first, one `fix:` commit each; minors in the handoff.

### Task 21: Live acceptance by eye (the studio's, with a phone)
- [ ] The five descriptions from the spec (a fox hero, a robot enemy, a wooden crate, a forest, a spaceship), on PC and the phone: the models read as not low-poly, the counts are inside the budgets on the card, the 2D sprite version plays in a 2D game, the Android build installs and holds its frame rate; screenshots into `docs/superpowers/notes/art-gate/`; write `slice9-results.md`.
