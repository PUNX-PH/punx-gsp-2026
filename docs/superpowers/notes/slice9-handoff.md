# Slice 9 handoff: the art pipeline (started 2026-10-09, branch `slice-9-art-pipeline`, 2 commits, not pushed)

Plan: `plans/2026-10-09-slice9-art-pipeline.md` (21 tasks). Spec: `specs/2026-10-08-art-pipeline-design.md`. The owner's two steers this session: **make better 3D models than the old kit, and keep the polycount good for games**
(per-target budgets, PC and Android); **3D as well as 2D**; **no presets: the user's own prompt drives the model** (the hand-made recipes below are only test fixtures).

## Done

- **Task 1, the gate:** five reference models built with the CURRENT kit and rendered (`blender-worker/tools/{make-art-recipes.mjs,art-gate.mjs,render-preview.py}`, pictures and numbers in
  `docs/superpowers/notes/art-gate/`). Finding: the old kit makes clean mechanical shapes but cannot make organic ones (the "fox" was a robot with floating ears, the "spaceship" a toy car), has no textures, and
  its four kinds fix the silhouette. Its triangle counts were far under its caps: the limit is vocabulary, not budget. The owner saw the pictures and asked for better models.
- **The freeform vocabulary (new kind `model`, Python side only):** `blender-worker/scripts/freeform.py`. A recipe is a list of up to 48 parts: `ellipsoid, capsule, cylinder` (with `taper`), `box` (`bevel`), `torus`
  (`thickness`), `lump` (`seed`), `tube` (points, radius, taper), `revolve` (a lathe `profile`), `loft` (cross-sections `{z,w,h,round,dx,dy}` along z), each with `at`, `size`, `rot` (degrees), `material` (index into up to 6
  materials `{color slot 0-4, finish matte|painted|metal|rubber|glow}`), `mirror`, `detail` (1 to 3: segments). `check_model` refuses anything outside the closed lists and ranges (a rotation over 360 degrees was
  caught that way). Model axes x side, y up, z forward; feet at y = 0. Build one: `blender -b --factory-startup -P blender-worker/tools/freeform-build.py -- recipe.json out.glb [stats.json]`;
  render: `render-preview.py` (Cycles, CPU). Recipes and generator: `blender-worker/fixtures/recipes/freeform/`, `tools/make-freeform-recipes.mjs`.
- **Result (pictures in `art-gate/v2/`):** fox 10,950 triangles, robot 6,430, crate 3,504, pine 4,160, spaceship 3,672: all read as what they are. All inside PC budgets; the fox is over the mobile hero budget (5,000).

## Not done (in order of what to do next)

1. ~~Wire `model` into the worker~~ **Done (2026-10-09).** A model body is `{ recipe, palette, role: hero|prop|scenery, target: pc|mobile }` (no motions yet); `recipe.mjs` checks it (`checkModelBody`), `build.py`'s `run_model` calls
   `freeform.build_model` with the budget from `kit.json` `freeform.budgets` (the caps are there too, one source for Python and JS). Fitting (`freeform.fit_parts`): detail down 3, 2, 1 on every part, then parts from the end of the list, counted
   on scratch meshes before the one export, then verified by the real GLB count (one more part dropped if somehow over); exit 5 when not even one part fits. Stats carry `parts` (kept), `dropped`, `vertices`; the server returns `X-Vertices` for a model.
   Tests: `recipe.test.mjs` (freeform block, 63 worker tests pass) and `tests/test_blender.py` `BuildFreeform` (6 pass). **`JOB_VERSION` not bumped:** old recipes build identical output; but `buildKey` (`web/src/lib/blender/key.ts`) must include
   `role` and `target` for models (Task 9). The server does not yet send `X-Dropped`; add it if the card should say "detail reduced".
2. **Web side (Tasks 8, 9, 10):** `recipes.ts`/`repair.ts`/`kinds.ts` for the `model` recipe, the **design prompt that teaches Claude to compose** (axes, feet on y = 0, the palette slots, mirror for symmetry, the shapes and their limits, the triangle
   budget, silhouettes first), the answer as JSON text in ONE string field (a big schema is refused by the API: "compiled grammar is too large"), `style`/`detail`/`view` on asset requests, the builder building PC and mobile
   variants as two cached calls, Build Model's card showing triangles per variant. The studio window already shows any GLB.
3. **Animation for freeform models:** a freeform GLB has no clips. Needs rigs (parts bound to named joints; a `biped` and a `quadruped` rig with stock Run, Jump, Loop) or at least a Loop (spin or bob). Without it a freeform hero does not
   animate in the runner. Not started.
4. **Mobile variant and LODs (Task 6):** decimate to the mobile budget keeping the silhouette (bounding box within 5%), LOD1 50% and LOD2 15% in the same GLB. **Materials and baked textures (Task 5):** UVs, procedural wood, fur, panels, wear into
   one atlas per target (the exporter currently writes no texcoords or images). **Sprites (Task 7)** for 2D, rendered from the same models. **Unity (Tasks 12 to 14):** pick `.mobile.glb` by platform, LOD switching, sprite sheets, the governor.
5. Known look issues: the fox's cheeks read as muffs; metal looks washed in the preview (the sky is reflected: a lighting matter of the preview, not the game); no surface texture yet.
6. Gates, worker redeploy (the studio's), whole-branch review, live acceptance by eye with a phone: Tasks 15 to 21.

## Decisions and notes

- Skills from GitHub for Blender were looked at (cc-blender-skill, terminalskills and andrew1326 `blender-3d-modeling`, major-ai-skills): none installed (they drive a running Blender over MCP or are short intros; the need is our own recipe vocabulary).
  Blender 5.2.2 is installed at `C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`.
- Slice 8 and its follow-ups (Make it, studio window, prompt refiner) are on `main` and pushed; read `slice8-handoff.md` for what is live and the studio's open steps (packager redeployed and players uploaded by the owner on 2026-10-09; the live acceptance of Make it was
  still to be reported).
- The owner prefers building over testing: compile checks and one final run, not repeated suites (memory note `feedback-build-over-testing`).
