# Slice 10 handoff: generate everything from the prompt (2026-10-09, branch `slice-10-world`, not merged)

The owner's rule (said three times): the person prompts; we generate the code, the models, the characters and the environment, nothing premade, no templates, 3D (2D is a later slice: "to make things easy lets generate only 3D"), and show it in the preview. The plan is
`plans/2026-10-09-slice10-generate-everything.md`; memory notes `feedback-no-premade-no-templates` and `project-product-goal`.

## What was built (all tested; web 2,201, Unity PlayMode 45; nothing run against the real Claude or a real worker)

- **One enlarged answer** (`web/src/lib/script/prompts.ts`, `service.ts`): the script call now also returns `style` (realistic, stylized, cartoon, painted, flat) and `world` (`sky` and `ground` palette slots 1 to 5, up to **three** pieces of scenery in words). No kit `kind` any more.
  `web/src/lib/builder/world.ts` repairs both (never fails a game). `SCRIPT_VERSION` is 5 (old cached games are asked again).
- **Always 3D, never one genre:** the prompt allows only the 3D cameras (a request for 2D is made as the 3D equivalent) and shows **three 3D examples of different kinds** (a Frogger-style crosser, an arena collector, a side-view glider), all asking for models, with "the examples show the API, not the kind of game to make".
  Examples live in `unity/runner-template/Assets/Runner/Tests/Scripts/*.lua` and are mirrored in `web/src/lib/script/examples.ts` (a test keeps them equal).
- **Style in models:** `BuildModelInput.style` and Build Model's optional `style` setting reach the freeform design prompt and its cache key.
- **Scenery as models:** `BuilderService.buildScenery` (role scenery, design from words, PC build; the budget kit already had a scenery budget). **Build World** node (`build-world`, hidden from the Add step menu, soft): sky, ground, scenery words, style; output is the `environment` wire with `kind: "custom"` pieces.
- **Assemble Game** is the old Game Template renamed everywhere a person reads it (the node type id is still `game-template`); it carries the environment and the scenery files into a script game's settings and run; Preview stores them. The card shows only wired inputs until selected.
- **Generated graph** (`graph/generated.ts`): Describe Game, one Build Model per asset (style on each), one Build World when the plan has a world, Assemble Game, Preview. `makeGame.flow.test.ts` plays the whole path with fakes.
- **Unity player:** a made game is always lit (lit shader, the meadow's sun and fog); the ground plane's triangles faced down and were culled by the lit shader (fixed); objects rest on the ground; ground cameras get a sky; the environment's sky and ground colours and its scenery (a recycling pool beyond the field's edge) are drawn (`ScriptView.SetWorld`). Seen in pictures: the lit fox and crates, the world with scenery.
- **The phone is off:** `makeBuilderService({ phone })` defaults to false (one worker call per model); the code for phone variants (slice 9) stays.

## Not done, or not known

- **Never run with the real Claude:** what it writes for `style`, `world` and the scenery words, and whether three different genres come back for different ideas, is unseen. Look at a few live prompts first and tune `scriptSystemPrompt()`.
- **Time:** a game with 3 models and 3 pieces of scenery is 6 designs and 6 PC builds (about 6 s each on Cloud Run) plus the plan, inside Play's 270 s. Not measured live. Parallel builds would help.
- **The editor is not read-only yet** (the graph is generated, but still editable); 2D, sprites, textures, LODs, the rules-engine path (still the old kit models), the Windows and Android players (not rebuilt; they have the lit and world code only after `tools/build-players.ps1`).
- **Worker:** nothing changed in the worker for this slice; the one deployed on 2026-10-09 (revision 00006) is enough. The website and the WebGL template need the deploy: build with `tools/build-webgl.ps1`, publish with `tools/publish-template.ps1`, then push `main`.
