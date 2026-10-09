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

## Phone variant in the run, and Make it uses freeform (2026-10-09)

- A model's phone variant travels with it: `EntityFile = {file, sha256, mobile?}` on the game wire and the settings wire, the Game Template's numbered model inputs and `designEntityAssets` carry `mobile`; **Preview stores it as
  `entity-NAME.mobile.glb` after every other file**; `runs.putFile` accepts `X.mobile.glb` when the run needs `X.glb` (an extra, never a "need", so readiness is unchanged). **The Android export swaps it in under the normal name**
  (`entity-NAME.glb` gets the phone bytes; a run with no variant sends what it has); the Windows export never sees it. So the packager and the Unity player needed no change.
- **Make it's generated graph and the rules path (`designEntityAssets`) now build every model as "freeform"** (the AI's kit kind in the asset request is ignored). Revert by using `asset.kind` / `request.kind` again in `graph/generated.ts` and `engine/assets.ts`.
  This means a hero is one body with stock clips, not a rigged kit biped; judge by eye once the live key is there.
- The WebGL Preview plays the PC files. Still open: the Target setting, style/detail/view on asset requests, Unity picking by platform without the swap (not needed now), sprites for 2D.

## Whole-branch review (2026-10-09, a fresh agent; no Critical findings)

Fixed: **(Important) new faces of a part were found by list position; a bevel frees and reuses face slots, so after a beveled box the next part lost a face and two faces got the wrong material** (now by identity; the test fails without the fix: 204/1544 vs 216/1520
triangles by material); **(Important) Make it could be refused when Claude left an asset with no words** (a custom model needs a description: it now falls back to "a NAME (role)", in the generated graph and the rules path); a failed **phone build now keeps the good PC
model** (export falls back to the PC file); a recipe that builds nothing is refused (exit 5, not a 500); a repaired recipe over 56,000 characters is refused on the web (the worker takes 64 KiB); the worker checks the triangles against the budget again before sending.
Left as they are: the 8192-token cap on Claude's answer (a huge recipe shows as "did not answer"); the Quality High setting and the Run/Jump/Loop boxes are ignored for the Custom kind; two worker calls run one after the other.

## Not done (in order of what to do next)

1. ~~Wire `model` into the worker~~ **Done (2026-10-09).** A model body is `{ recipe, palette, role: hero|prop|scenery, target: pc|mobile }` (no motions yet); `recipe.mjs` checks it (`checkModelBody`), `build.py`'s `run_model` calls
   `freeform.build_model` with the budget from `kit.json` `freeform.budgets` (the caps are there too, one source for Python and JS). Fitting (`freeform.fit_parts`): detail down 3, 2, 1 on every part, then parts from the end of the list, counted
   on scratch meshes before the one export, then verified by the real GLB count (one more part dropped if somehow over); exit 5 when not even one part fits. Stats carry `parts` (kept), `dropped`, `vertices`; the server returns `X-Vertices` for a model.
   Tests: `recipe.test.mjs` (freeform block, 63 worker tests pass) and `tests/test_blender.py` `BuildFreeform` (6 pass). **`JOB_VERSION` not bumped:** old recipes build identical output; but `buildKey` (`web/src/lib/blender/key.ts`) must include
   `role` and `target` for models (Task 9). The server does not yet send `X-Dropped`; add it if the card should say "detail reduced".
2. **Web side: Tasks 8 and 9 done, Task 10 partly (2026-10-09).** New kind **"freeform"** ("Custom" in the Build Model Kind setting and the studio window; Auto still picks only the four kit kinds, until freeform animates).
   `web/src/lib/builder/freeform.ts` (types, `checkFreeformRecipe`/`checkFreeformBody` with the worker's words, `repairFreeform`: clamps, drops, caps; the answer is **one string field** `{recipe: "<JSON text>"}`, `FREEFORM_SCHEMA`),
   `freeformSystemPrompt()` in `ai/designPrompts.ts` (axes, feet at y = 0, every shape and its limits, palette slots, finishes, mirror, budgets from the kit, big masses first and small decorations LAST because parts are dropped from the end),
   `Designer.designFreeform`, the kit mirror (`kit.json` `freeform` is in `kinds.ts` KIT; the equality test covers it). `AnyBuildBody` = kit body | freeform body (`checkBuildBody` dispatches on kind "model"); `buildKey` for a freeform body includes role and target;
   the client reads `X-Vertices` for a model. `buildModel` with kind freeform: design once (cached in the same `builderDesigns` collection under kind "freeform" keys), then **two worker calls, PC and mobile** (role hero for the hero, prop for obstacle and collectible);
   `BuiltModel.mobile` and the node's output `mobile: {sha256, size}` (wire type `model`), the card says "N triangles (M on a phone)". `RECIPE_VERSION` not bumped (kit designs are unchanged).
   Tests: `builder/freeform.test.ts` (fixtures shared with the worker, repair, prompt, service), client tests; whole web suite 2164 pass. **Not run: Claude on the real prompt** (needs the live key: the first thing to check by eye is that the fox/robot/crate it designs read well).
   Still open of Task 10: the **Target** setting (both, PC, Android; now always both), style/detail/view on Describe Game's asset requests, Make it's per-model steps choosing freeform. **Task 11 is next for the web**: the run files do not yet carry `mobile`
   (`entity-NAME.mobile.glb`, export per target, packager names), and the Unity player does not yet pick it.
3. **Animation for freeform models: stock clips done (2026-10-09); rigs not.** The body has `clips` (a list of Run, Jump, Loop, checked on both sides). `build.py` `STOCK_CLIPS` are motions on the model's one object (origin at the middle of the feet, so turns
   and stretches happen about them), baked with the existing `bake_clip`: **Run** a bob with a little rock and pitch, **Jump** a stretch, **Loop** a slow turn with a bob. The web asks for a hero Run and Jump, a collectible Loop, an obstacle none
   (`freeformClipsOf`); the clips are in the key, the GLB and the card's "Moves:". **Not run in Unity** (no Hub sign-in): that the runner plays a single-node clip is expected (same clip names as every other model) but unchecked.
   **Rigs done (2026-10-09):** a recipe may have `rig` ("biped": head, arm, leg, tail; "quadruped": head, leg_front, leg_back, tail; in `kit.json` `freeform.rigs`) and each part may name a `joint` of it. `freeform.py` groups parts into one mesh
   per joint (a sided joint, arm, leg, leg_front, leg_back, is made twice, `_l` for the +x side and `_r`, and a mirrored part puts its mirror image in the other), puts an empty at each pivot (top of its parts for limbs, bottom for the head, the
   end nearest the body for the tail) under a root empty "model", and meshes parented without moving (the same structure as the kit's models). `build.py` `STOCK_CLIPS[rig]`: biped Run swings legs and arms in opposition with a nod and a tail whip,
   quadruped trots with diagonal legs together; Jump tucks limbs and stretches; Loop turns the root. Tracks on joints a model lacks (a part was dropped for the budget) are left out. Claude's prompt teaches rigs; repair drops joints the rig lacks (the
   part becomes body); `fixtures/recipes/freeform/fox-rigged.json` is the test fox. Tests: Blender (nodes per joint, limbs rotate in Run, hip heights, bad joints exit 5), worker and web checks. The rigged fox renders like the static one.
   **Not run in Unity** and not by the real Claude: whether Claude binds joints sensibly (a limb's top sunk in the body, mirror on the +x side) is the thing to look at.
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

## Unity suites run (2026-10-09, Hub sign-in valid again)

`Unity.exe -batchmode -projectPath unity/runner-template -runTests -testPlatform EditMode|PlayMode` on 6000.3.25f1, from the slice 9 branch: **EditMode 349 tests, 346 passed, 0 failed, 3 skipped** (the `[Ignore]`d LiveScriptsTests and two Explicit
WinnabilityGoldenTests, by design; 328 s); **PlayMode 28 of 28 passed** (12 s). No tracked file changed and no `.meta` file was missing. Still not run in Unity: a rigged freeform GLB playing its Run clip in the runner (needs a PlayMode test that loads one), the
rebuilt WebGL template and the Windows and Android players (`tools/build-players.ps1`), the phone budgets.

**Freeform in the Unity player (2026-10-09): checked.** `Assets/Runner/Tests/PlayMode/FreeformModelTests.cs` and `Assets/StreamingAssets/sample-freeform` (hero.glb the rigged quadruped fox from `fox-rigged.json`, obstacle.glb the crate, coin.glb the spaceship; all made by
`build.py` itself, PC target; settings.json like sample-built): PlayMode is now **33 of 33**. The tests show glTFast imports a node for every joint and a mesh for each (head, tail, four legs), the player takes the hero's Run and Jump, the legs really trot (a front leg against the
other front leg and against the back leg on its own side, correlation under -0.3), the legs stay attached while they swing, Jump follows the air progress and Run returns, a collectible plays Loop and a crate has no clips. **Mutation:** with an un-rigged fox as the hero 4 of the 5 fail.
So the claim "the runner plays rig clips" is now verified. Still not run in Unity: the rebuilt templates and players, the phone budgets.

**Players rebuilt (2026-10-09, `tools/build-players.ps1 -Platform both`, both "Build Finished, Result: Success"):** `Builds/upload/windows.zip` (35.8 MB; a real zip made with Windows' `tar.exe -a -c` from `Builds/player-windows`, forward-slash entries, the `*DoNotShip*` Burst folder excluded; **not** Git Bash's GNU `tar`, which writes a plain tar
named .zip) and `android.apk` (30.0 MB, from `Builds/player-android/Runner.apk`), `players.json` unchanged. There is no Unity runtime change in slice 9, so the players differ from slice 8's only by the new `sample-freeform` StreamingAssets. **Not uploaded** to `gs://punx-gsp-players`
(the studio uploads through the Cloud Console; ask first), and the packager is not redeployed.

## Made games look lit and 3D by default (2026-10-09; the user's steer: "users prompt, we attach what quality needs")

Seen in a screenshot of the live Frogger-style game: Claude asked for no models and the player drew flat unlit boxes. Fixes, none needing the person or Claude to ask:
- **Prompt** (`web/src/lib/script/prompts.ts`): make the game 3D unless the person asks for 2D, flat, side-scrolling or pixel art (a "top-down" game is the top camera, 3D); ask for a model for every character and important object (the player first, then enemies, pickups, vehicles, animals, obstacles), primitives only for terrain, floors, water, walls and scenery.
  `SCRIPT_VERSION` is 2, so earlier cached games (like "Reused your earlier result") are asked again.
- **Unity player:** a made game (script or rules) is now always lit: `BootScript` and `BootGame` use `Runner/Lit` for the models and the primitives and apply the meadow's sun, sky and fog (`WorldLook`). The ground plane's triangles faced down and a lit shader culled it, so it was
  invisible from above (`PrimitiveMeshes` plane, fixed; its colour is lighter); ground cameras (top, chase) get a daytime sky tinted by the palette; objects never sink below the ground (a script that leaves z at 0 still rests on it).
  Seen by eye with a throwaway PlayMode probe that rendered the 3D lane runner with the freeform fox and crate (screenshots in the session scratchpad, not committed). Tests: `MadeGameLookTests` (4, all fail without the change); PlayMode 37, EditMode 346 of 349 as before.
- **Still the player's flat Frogger-like look:** the 2D cameras (side2d, top2d) stay flat orthographic with the dark backdrop. The WebGL templates must be rebuilt and published (`tools/build-webgl.ps1`, `tools/publish-template.ps1`) and the Windows and Android players rebuilt and uploaded for it to show everywhere.
