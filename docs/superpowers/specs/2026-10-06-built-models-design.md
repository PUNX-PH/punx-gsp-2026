# Slice 6: Built models, motion and environment (Build Model and Build Environment)

Date: 2026-10-06. Status: awaiting review. Path: architectural (two new steps, a new worker job, a change to the Unity template and the
settings contract). Builds on the graph engine (`2026-10-03-graph-engine-design.md`), the node canvas (`2026-10-04-node-canvas-design.md`),
Describe Game (`2026-10-04-describe-game-design.md`, the pattern for the AI calls) and Blender assets (`2026-10-05-blender-assets-design.md`,
the worker). The evidence behind the choices is in `docs/superpowers/notes/slice6-spikes.md`.

## Purpose

Today a game's hero, obstacles and collectibles are built-in shapes, one of seven Make Shape shapes, or an uploaded model, and none of them
move. The ground is one flat slab on a plain background. This slice lets a creator describe things in words and get models that **move**, and
a world around the track:

- **Build Model** makes a hero, an obstacle or a collectible from a description. Claude writes a *recipe* (data, never code or a mesh); the
  Blender worker builds a low-poly model with a skeleton from it, plus the motions the creator asked for in words (Run and Jump for a hero,
  Loop for the rest).
- **Build Environment** makes the world around the track from a theme: sky, field and track-edge colors, and up to three kinds of animated
  scenery (trees that sway, windmills that spin) along both sides.

The v1 spec ruled out "AI 3D generation". This slice does not generate meshes with an AI: the AI chooses from a fixed kit and fills in
bounded numbers, and Blender, which we run, builds the model. No paid 3D service is involved.

**Amended 2026-10-06 (after the quality showcase): a High quality tier, optimized.** Everything above is the **Standard** tier (low-poly,
flat-colored, phone-safe, the default). A creator can set **Quality: High** on Build Model and Build Environment and get lit, detailed models and
a real world (sky, sun, dunes or hills, a road, distant mesas) while staying inside hard performance budgets. The showcase proved the look is
reachable but also showed what *not* to ship: a 63,000-triangle hero and a 40 to 60 second load. The tier is defined by its budgets, not by
how much detail can be added ("The quality tier" below).

**Done for this slice** (each is a check on the live site unless it says otherwise):

1. Signed out, nothing can reach Claude or the worker (every graph page and API call is still refused; the worker answers 403).
2. A creator adds Build Model (role hero), types "a red fox in a scarf", presses Play, sees the kind, part count, triangles and clips on the
   card, and plays a game whose hero runs while on the ground and plays the Jump clip, in step with the jump, in the air.
3. Changing only the Run or Jump box changes the motion and **not** the look; changing the description changes the look.
4. An obstacle and a collectible built the same way (role obstacle or collectible, a Loop box) move in the game.
5. Build Environment with a theme ("a windy meadow") gives the game a field, edge stripes, a sky color and animated scenery on both sides,
   which recycle as the hero runs and never pop.
6. With a kind chosen and an empty description, Build Model builds the built-in default for that kind with its default motions and
   **calls no AI**; with an empty theme, Build Environment builds a default "meadow". So everything above except the words works before
   the studio has an Anthropic key.
7. Pressing Play again unchanged shows "Reused your earlier result" and makes no Claude call and no worker call.
8. Plain refusals, each on the step (the table under Error handling).
9. A finished game holds 30 frames per second or more on a real phone (a manual check, Unity's mobile build).
10. No secret is in the repository, the worker is still private, and the Claude key exists only in Vercel.
11. **High quality, optimized.** With Quality set to High on Build Model and Build Environment (kinds chosen, boxes empty: no AI needed), the game
    looks lit (sky with a sun, metal and glow finishes, a soft contact shadow, fog, a road, dunes or hills, distant mesas) and every budget in
    "The quality tier" holds: model triangles and vertices, visible triangles, active renderers, the run folder's size, and **ready in 15 seconds
    or less** on a desktop browser at **60 frames per second or more**. On a phone the game steps its own detail down to keep **30 or more**.
12. A Standard game is unchanged: flat look, the Standard budgets, and settings files from before this tier play exactly as before.

Covered by tests, not on the live site: the recipe checks and repairs, the Blender builder for every kind, the motion baking, the Jump
sync, the settings contract on both sides, the cache keys and the limits.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| Who makes the mesh | Our own Blender worker, from a recipe Claude writes | No per-model fee, no GPU, the skeleton is known by construction (no joint-fitting). Tripo's published prices come to about $0.55 to $0.65 per rigged hero, Meshy's rigging works only on two-legged models (its dollar price per credit was not confirmed), and self-hosted open models need a 24 GB GPU and give no rig. |
| What Claude returns | Data in a fixed shape, never code | A Claude-written Blender script would run untrusted code in the worker. Data is checked, clamped and bounded. |
| Style | Blocky low-poly made of primitives (Crossy Road style) | The honest limit of recipes, and it matches "hypercasual, simple low-poly or flat art". Realistic meshes are a later swap-in (see out of scope). |
| Model structure | Rigid parts joined into one mesh per joint, node animation, no skin | Spike: no weights to get wrong, about 100 KB against about 160 KB, identical playback in the WebGL player. |
| Who decides the motion | The creator, by prompt: **Run** and **Jump** boxes for a hero, a **Loop** box for an obstacle or collectible. An empty box means the default motion for that kind | The studio's choice. Defaults mean nobody has to write anything. |
| Calls to Claude | Two, cached separately: **design** (the look) and **motion** | Editing a motion box must not change the character. A model asked again may answer differently, so the look is kept by its own cache entry. |
| Kinds in version 1 | Two-legged character, wheeled vehicle, bouncy blob, simple prop (spin or bob). Four-legged animals and flyers are the next addition | Same machinery, new skeleton templates; the studio asked to stage by risk. |
| Environment | A theme prompt; Claude picks colors and up to three scenery kinds from a built-in kit | Variety without a part builder for every scenery idea. |
| AI is optional | A chosen kind with an empty description builds the default for that kind | Lets the whole slice be checked live while the Anthropic key is still unfunded (slice 4 is parked for the same reason). |
| Colors | Recipes use palette slots (0 to 4), never hex | A palette change re-colors without asking Claude again, and the readable-HUD guard from slice 4 keeps working. |
| Where the model's role is chosen | A `role` setting on Build Model (hero, obstacle, collectible) | The step then knows which boxes to show and which clips to build, and the Unity template only plays what exists. |
| Quality tier | A `quality` setting on Build Model and Build Environment: **Standard** (default) or **High** | The studio asked for the best quality we can make, and for it to be optimized. A setting keeps phones and cheap games on the Standard path. |
| What defines High | Hard budgets (triangles, vertices, meshes, materials, visible triangles, renderers, run-folder size, load time, frame rate), checked by the recipe check, the worker and the tests | The showcase's brute-force detail loaded in 40 to 60 s; a budget makes quality something the pipeline can promise. |
| How High stays small | Detail from finishes, bevels on large parts only, and baked vertex-color cavity shading; shared vertices; one mesh per joint group; a deterministic budget fit that drops detail in a fixed order | Looks rich without triangles; fewer vertices to decode and fewer draw calls. |
| The lit look | Settings gain an optional `look` (`flat` or `lit`); the template ships both shaders, and GPU instancing for the pooled clones | The showcase shader, cleaned up; old games stay flat. |
| Slow devices | The template measures its own frame time and steps detail down in fixed levels (never back up in a session) | Keeps 30 fps on a phone without a separate build, and without asking the person. |
| Dependencies | None added: no Draco, no meshopt | Both need a new package; if the load budget cannot be met without one, that is a separate decision. |

## Out of scope for this slice

Four-legged and flying kinds; skinned meshes and single-mesh imports; rigged uploads (Prepare Model still removes rigs and animations);
realistic meshes from an open image-to-3D model with an automatic rigger (they can later sit behind Build Model's design call); a motion
viewer on the card (the creator sees the motion by pressing Play); Idle, hit, collect and game-over animations; scenery beyond the kit;
sound; real-time shadow maps (the lit look has a soft contact shadow only); mesh compression and level-of-detail meshes; textures; a second
template; a job queue or parallel steps in Play.

## What the person sees

- **Build Model** (new). Inputs: an optional `palette` and an optional `image` (a look reference, read like Describe Game's). Output: `model`.
  The side panel has: **Role** (hero, obstacle or collectible, default hero); **Kind** (Auto, or one of the four; default Auto);
  **What is it?** (up to 300 characters); and the motion boxes: **Run** and **Jump** (up to 200 characters each) for a hero, **Loop** for the
  others. One plain line says what is sent to Anthropic. The card shows the kind, parts, triangles, size, the clips and Claude's one-line
  summary, and "Reused your earlier result". If a motion asked for a part the model has no joint for (a tail on a blob), the card says which
  motion part was skipped.
- **Build Environment** (new). Optional `palette` input; output `environment` (a new wire type). Panel: **Theme** (up to 200 characters) and
  **Scenery** (few, some or lots; default some). The card shows swatches for sky, field and stripes and the names of the scenery.
- **Game Template** gains an optional `environment` input. Without one the game looks as it does today (no extra cost). A hero without
  a Run clip, or an obstacle without a Loop clip, plays still, as today; a model whose role does not match its slot is refused in plain words.
- **A third starter graph**, "Build a character": Build Model (hero, kind two-legged), Build Environment, Game Template, Preview, working
  with every box empty (no AI).
- **Quality** on both new steps: **Standard** or **High** (default Standard), with one plain line: "High looks best on a computer. On a slow
  device the game lowers its own detail." The card adds "High quality" and the real numbers ("11,820 triangles, 9,100 vertices, 387 KB").

## The quality tier (High), optimized

The tier is a **contract of budgets** plus the techniques that meet them. Standard keeps every number above. The recipe check, the worker's
second check and the Blender tests all enforce the High budgets, so a recipe that would break one is repaired or refused before Blender runs.

| Budget (High) | Biped | Vehicle | Blob | Prop | Scenery piece |
|---|---|---|---|---|---|
| Triangles | 12,000 | 6,000 | 5,000 | 3,500 | 1,500 |
| Vertices (shared, welded) | 9,500 | 4,800 | 4,000 | 2,800 | 1,200 |
| Parts | 80 | 50 | 30 | 24 | 24 |
| Meshes (one per joint group) | 14 | 10 | 6 | 5 | 3 |
| Materials | 7 | 7 | 7 | 7 | 7 |

World pieces (High environment, three GLBs): terrain tile 8,000 triangles and 4,200 vertices, road 1,500 and 1,200, backdrop 1,200 and 700.

**Game-level budgets, measured and recorded** (default recipes, every step High, desktop browser on the studio's machine): at most **100,000
triangles visible** at once; at most **100 active renderers** (Standard keeps 120); the run folder's GLBs at most **1.5 MB** and **60,000
vertices** together; **ready within 15 seconds** from the start of loading (the template logs it); **60 frames per second or more**; on a phone,
**30 or more**, kept by the governor below. Each budget has a test or a recorded measurement in the plan.

**How the builder meets them** (all in `build.py`, all driven by fixed tables, never by a field used as code):
1. **Finishes, not geometry.** Each color slot gets one finish from a fixed list: `matte`, `painted`, `metal`, `rubber`, `glow`. A finish is a
   metallic, roughness and emission setting, so metal and glow cost nothing in triangles.
2. **Bevels where they show.** Rounded edges only on parts above an area threshold, with segment counts fixed by the tier; small parts stay hard.
3. **Details from a fixed list**, each priced in triangles: `seams`, `bolts`, `cables`, `lights`. A deterministic **budget fit** adds details in
   priority order while the budget holds and drops the lowest-priority ones when it does not (cables, then bolts, then seams, then lights,
   then extras, then bevel segments), so the builder never exceeds a budget and the same recipe always gives the same model.
4. **Baked cavity shading.** A cheap per-vertex multiplier (0.55 to 1.0) from how concave the surface is and how low it sits, stored as vertex
   color. It gives contact depth for free; the lit shader multiplies it in.
5. **Shared vertices and one mesh per joint group.** Vertices are welded, normals smoothed by angle, parts joined, so there are fewer vertices
   to decode and fewer draw calls.
6. **A real world, small.** Terrain is a 2 m grid with shared vertices that repeats seamlessly every 100 m; the road and its markings are one
   mesh; the backdrop is one ring mesh. Two styles in this slice: `desert` (dunes, asphalt, mesas, sunset) and `meadow` (rolling hills, a
   dirt road, distant hills, daylight). Colors come from the palette slots, so a palette change recolors it.

**How the template stays fast** (Unity):
- **Lit look.** `settings.look` is `flat` (the default, today's shader) or `lit` (the showcase shader, cleaned up: sun, sky and ground light,
  metal and rim light, emission, vertex-color shading, fog, a filmic curve). A game is `lit` when any wired model or the environment is High.
- **GPU instancing** for the pooled clones (they share a mesh and a material), so ten crates cost about one draw call.
- **No per-frame allocation**; pooled scenery and tiles are repositioned by slot, as today.
- **The quality governor.** A small pure class watches the average frame time over 3 seconds. Above 34 ms it steps down one level (at most one
  step every 5 seconds, never back up in a session): level 1 hides every other scenery item; level 2 drops scenery, the backdrop and the contact
  shadow; level 3 switches the lit shader to its simple branch (half-Lambert and fog only). `debug=1` shows the level.
- **Load.** The template logs `RUNNER ready in N ms`; the budgets above are what keep it low (glTFast decodes on one thread, so decode time
  follows vertex count).

**Settings contract.** `settings.json` gains an optional `look` (`flat` or `lit`) and the `environment` object gains an optional `world` (`style`
`desert` or `meadow`; the three world files have fixed names `terrain.glb`, `road.glb` and `backdrop.glb`). Both are additive under schema
version 1 and checked on both sides with shared fixtures.

**Cost and limits.** A High build counts as one Blender job (they take a few seconds, well inside the 60 s kill); Claude's calls are unchanged
except that the prompts carry the tier's kit (finishes, details, world styles). The tier is part of every cache key.

## Architecture

```
Play -> Build Model -> design cache -miss-> Claude (design) --\
             |                                                +-> checked recipe -> build cache -miss-> worker POST /build -> GLB
             +-------> motion cache -miss-> Claude (motion) --/                                                  |
Play -> Build Environment -> design cache -miss-> Claude (theme) -> checked environment recipe -> up to 3 /build calls (scenery)
                                                                                                                  v
                                           stored with the graph's files -> Game Template (settings.json + .glb files) -> Preview (Unity)
```

### The recipes (data)

Every field is bounded, and Claude's answer is only ever clamped, trimmed or refused, never trusted.

**Model recipe** `{ version: 1, kind, summary, build: {...}, extras: [...] }`

- `kind`: `biped`, `vehicle`, `blob` or `prop` (and `scenery` for the environment's pieces).
- `build`: numbers in fixed ranges, for example the biped's head size, torso width and height, arm and leg length and thickness, foot size;
  the vehicle's body length, width and height, cab size and wheel count (2 to 6) and radius; the blob's radius, squash and eye pair; the
  prop's shape (the seven Make Shape shapes, plus `gem` and `crate`) and size.
- `colors`: part slot to palette index 0 to 4.
- `extras`: at most two of `tail`, `ears`, `antenna`, `hat`, `backpack` (each adds a part and a joint chain). The scenery kinds are `tree`,
  `pine`, `rock`, `cactus`, `windmill` and `lamp`.
- Caps for every kind: at most 24 parts, at most 2,000 triangles (scenery 600), and one mesh per joint after joining.

**Skeleton templates** (fixed, named, one per kind). Biped: hips, spine, chest, neck, head, upperarm, forearm and hand on each side, thigh,
shin and foot on each side (17 joints) plus the chain for each extra. Vehicle: body and one joint per wheel. Blob: body and an eye each.
Prop and scenery: a root and, for animated scenery, one moving child (canopy, blades).

**Motion recipe** `{ version: 1, motions: { run?, jump?, loop? } }`, each motion `{ seconds, tracks }` with at most 12 tracks. A track is
`{ joint, channel: rotate | move | scale, axis, wave: swing | spin | bounce | pulse | hold, amplitude, cycles, phase }` with the
amplitude range fixed per channel and cycles from 0.5 to 4. A track naming a joint the model does not have is dropped (and reported on the
card). Blender bakes each motion at 24 frames per second to node keyframes. Every kind has a default motion for each clip, written by hand
and tested, so an empty box always works.

**Environment recipe**: `{ version: 1, sky, field, stripe }` (palette indices), `scenery` (up to three kinds from the kit) and `density`.

### The AI calls

- Ports as Describe Game: `designModel`, `designMotion` and `designEnvironment`, each with a fake for tests and one real adapter, so every
  rule here is tested without the network. Anthropic's SDK, Claude Sonnet 5.5 as one named constant, no tools, a 60 s timeout capped by
  Play's clock, structured output in the fixed shapes above. The kit, the ranges and the joint names of the chosen kind are in the prompt and
  checked again afterwards. The picture is re-encoded exactly as slice 4 does.
- **Checking and repairing**, in order: parse against the shape; unknown kind or extras refused or dropped; numbers clamped into range;
  parts and triangle caps enforced by dropping the lowest-priority parts; unknown joints dropped from motions; the summary is plain text of
  at most 140 characters. Anything that cannot be repaired fails the step ("The AI could not build this. Try different words.").
- **Auto kind**: the design call picks the kind. A chosen kind is given to Claude and not left to it.
- **When each call is made.** The design call only when the description has text; the motion call only when at least one motion box
  has text (an empty box takes that kind's default motion). A step with no text anywhere never calls Claude, and then needs a chosen kind.

### The build job (`blender-worker/`, one new endpoint)

`POST /build` takes `{ recipe, motions }` as JSON (a few KB) and returns the GLB, with `X-Triangles`, `X-Parts` and `X-Clips`. The worker
**checks the whole body again** against the same bounds, independently of the caller, then runs a new Blender script, `build.py`, that has
one builder function per kind, each building primitives, joining them per joint, creating the joints as a node hierarchy, and baking the clips
as named animations (`Run`, `Jump`, `Loop`). No field is ever used as code, a path or a Blender property name. Export is Y-up with flat colors
and nothing else, like `prepare.py`. New error code `bad-recipe` (422); the rest as slice 5. The container, auth, one-job-at-a-time and
60 s kill are unchanged.

### The calling side (`web/src/lib/blender/` and `web/src/lib/ai/`)

- A **builder service**, in the style of the Describe Game and Blender services: design cache, motion cache and build cache (all Firestore,
  keyed by the person where the AI is involved), limits, the three ports and the worker client.
- **Keys.** Design: `[version, model, uid, description, kind setting, role, image hash]`. Motion: `[version, model, uid, kind, joint list, the
  motion texts]`. Build: `[JOB_VERSION, recipe, motions, resolved palette hexes, graph id]`. So a palette edit re-colors with no Claude call,
  a motion edit re-bakes with the same recipe, and a repeat Play touches nothing. `JOB_VERSION` is bumped whenever `build.py` changes.
- **Limits.** A new design or motion answer counts against slice 4's AI limits and a new build against slice 5's Blender limits (cache hits
  count nothing, refunds as before). With no AI involved (empty description, default motions) only the Blender limit is used.
- Derived files (the GLBs) are stored in the graph's folder by SHA-256 through the existing files port; a record whose file is gone is a miss.
- New wire type `environment` with its word in `WIRE_WORDS` and a color in each theme, as `feel` was added in slice 4. The `model` wire
  value gains optional `role` and `clips` fields (a built model records the role it was built for and the clips it has; uploads and shapes
  leave them empty), which is what Game Template's role and clip checks read.
- **Game Template** gets the optional `environment` input, adds the scenery files and the `environment` object to the settings it builds, and
  checks that each model's clips fit its slot.

### Play's time budget

A first Play of a whole game can have a hero, an obstacle, a collectible and an environment: up to seven Claude calls (two for each model, one for the
environment) and up to six worker jobs (three models and up to three scenery pieces), in sequence. The expectation is roughly 100 to 150 seconds with a cold worker (unmeasured: the plan measures it), inside the 270 second deadline from
slice 5. If it runs out, the existing message tells the person to press Play again and finished steps are kept, so it carries on. Running
steps in parallel is the known later improvement.

### The Unity template (built on the studio's machine, as always)

1. **Clip selection.** The hero plays `Run` as a loop. In the air it plays `Jump` and the template sets the clip's time every frame from the
   sim's progress through the jump: `RunnerSim` gains a read-only `AirProgress` from 0 to 1, computed from its vertical velocity, so the
   clip always fits the airtime, which changes with the jump height. On landing it crossfades back to `Run`. Obstacles and collectibles
   play `Loop`, each starting at its own random phase. A missing clip means no animation, as today.
2. **Environment.** An optional `environment` object in `settings.json` gives sky, field and stripe colors (palette indices), a density and
   up to three scenery files. The template builds the wide field, the edge stripes (one combined mesh) and a pool of scenery along both
   sides that is recycled by the hero's distance, with a fixed model per slot so nothing pops. Scenery is sized by height only (no hit-window
   footprint cap) and is never a hit target.
3. **The settings contract.** The `environment` object is **additive under schema version 1**: Unity's reader ignores fields it does not know
   and treats missing ones as null, which `fixtures/settings/valid-extra-fields.json` already relies on. The web `validateSettings`
   and the Unity `SettingsParser` both gain the same checks (indices 0 to 4, at most three scenery files, each a plain `.glb` name), with
   shared fixtures on both sides: valid with and without an environment, and invalid ones (a path, four files, a bad index, a non-`.glb`).
4. **A renderer budget.** At most 120 active renderers in a running game (the spike measured about 170 with unjoined parts). A PlayMode
   test counts them, and the phone check is the real judge.
5. The template is rebuilt and published (`tools/publish-template.ps1`) as a new version; old settings files keep working.

## Security

- Prompts and pictures are untrusted. Claude has no tools and returns data that is checked twice, in the web app and in the worker, so an
  instruction hidden in a prompt can at worst produce an odd but valid model or wasted cost, which the limits bound.
- The worker takes a small JSON body, never a file; no field is evaluated as code or used as a path. It stays private with the no-roles
  runtime account, 2 GiB, one job at a time and a 60 s kill.
- GLBs the worker returns go through the existing `checkGlb` (which already accepts animations and skins and refuses any `uri`).
  Scenery file names come from the template's own fixed list in the settings, never from a creator's text.
- Logs carry the step, the outcome, counts and statuses, never a prompt, a picture, a recipe's text or the key.
- Data leaves the studio exactly as in slice 4: the description and a downscaled picture go to Anthropic, and the panel says so in one line.
  A build with an empty description sends nothing anywhere.

## Error handling

| Cause | On the step |
|---|---|
| Kind Auto and no description | "Build Model: describe it first, or pick a kind." |
| Over the character limit | "Build Model: the description is longer than 300 characters." (a motion box: 200) |
| Answer not in shape or beyond repair | "Build Model: The AI could not build this. Try different words." |
| A motion asks for a joint the model does not have | (not an error) the card lists what was skipped |
| Daily AI or Blender limit | "Build Model: you have used today's AI answers (or Blender jobs). Try again tomorrow." |
| AI service failing | "Build Model: The AI service did not answer. Try again." |
| Claude declines | "Build Model: The AI declined this request. Try different words." |
| Worker down, auth, 5xx | "Build Model: The Blender service did not answer. Try again." |
| `bad-recipe` (a defect on our side) | "Build Model: the Blender service could not build this. Try different words." and a log entry |
| `timeout` | "Build Model: this took longer than 60 seconds. Try a simpler one." |
| No time left in Play | "Build Model: Play ran out of time. Press Play again; finished steps are kept, so it carries on." |
| Role does not match the slot | "Game Template: the hero model was built as an obstacle. Set its role to hero." |

Build Environment uses the same sentences with its own name. A failed step skips what depends on it, as always.

## Testing and acceptance

- **Test-first, with fakes (no Blender, no network):** the recipe shapes and the clamp-and-drop repairs as tables (every field out of range,
  unknown kind, unknown extras, too many parts, too many tracks, an unknown joint); the three cache keys (each input changes exactly the
  keys it should, a motion edit leaves the design key alone, a palette edit changes only the build key); the services (hit, miss, limits taken
  and refunded, each error sentence); the executors; the Game Template role and clip checks; the `environment` wire in the rule and the canvas;
  `validateSettings` against the shared fixtures.
- **Blender scripts, on the recipes in `blender-worker/fixtures/`** (needs Blender 5.2): every kind with its default recipe and a stress recipe
  at the caps. They assert the joints and clip names, clip lengths, triangles and parts within caps, one mesh per joint, bounds, Y-up, flat
  colors and a GLB that re-imports with its animations. The worker wrapper tests gain `/build` with a fake Blender, including a hostile body.
- **Unity EditMode:** `AirProgress` against the jump formula over the tuning range, the clip-time function, the settings parser with and
  without an environment, the slot-to-model mapping for the scenery pool (the same slot always the same model). **PlayMode:** a hero with
  clips loads, its probe joints move while running and the clip switches with the jump (the spike's probes as real tests), pooled
  collectibles keep animating, scenery recycles without a change in position or model, and the active renderer count stays within budget.
- **Editor:** `renderToString` tests for the two panels and cards, as in slices 3b to 5.
- **The High budgets:** the recipe check and the worker's check refuse or repair a High recipe over a budget (a table over every budget and every
  kind, shared fixtures accepted and refused the same way on both sides); the Blender tests build every kind's default High recipe and a stress
  recipe and assert triangles, vertices, parts, meshes, materials, the file's size, the finishes' metallic, roughness and emission, that the
  cavity multiplier is within 0.55 to 1.0, and that the same recipe gives the same counts twice; the terrain tile's first and last rows match
  (seamless); a test adds up the default recipes' real output against the run-folder and vertex budgets. Unity: the governor against recorded
  frame times (steps, spacing, never back up), the lit settings and world file checks, and a PlayMode renderer count of 100 or fewer with every
  step High. A recorded measurement, not a pass or fail, covers the load time and the frame rates.
- **Live acceptance:** the done-criteria above, in a real browser, then on a phone.

## Risks

1. **Quality is partly taste.** Blocky models from bounded numbers will be plain; the checks make them valid, not pretty. Judged by eye with
   the studio on real prompts. The honest ceiling is a Crossy Road look.
2. **Claude's motion recipes may look odd.** The default motions are the fallback, and clearing a box restores them. A motion viewer on the
   card would help and is deferred.
3. **No Anthropic key yet.** Everything except the words works without it (done-criterion 6); the AI half waits for the studio's funded key,
   the same blocker as slice 4, and is built and tested against the fake meanwhile.
4. **Play time.** Sequential steps may need two presses on a very first Play of a full game (the resume rule already handles it).
5. **Phone performance is unmeasured.** The renderer budget and the phone check exist for this; if a phone cannot hold 30 fps the scenery
   density default drops.
6. **A template rebuild is needed** on the studio's machine, which needs the Unity Hub sign-in to be active (a batch build fails without it),
   and the new template must be published and the live checks repeated.
7. **A big slice.** The plan splits it into stages that can each be tested alone (below) so a problem in one cannot hide in the rest.
8. **High is one design family.** The two-legged High model is the showcase's toy-robot character (visor, panels, antenna, parcel, scarf)
   varied by proportions, finishes, colors and extras. A fox or a knight will be a toy-robot fox or knight. More families are later work.
9. **The load budget may not be reachable without compression.** Decode time follows vertex count, so the budgets are the lever. If the
   measured load is over 15 s on the studio's machine, the options are lower budgets or a mesh-compression package, which is a new
   dependency and the studio's decision.
10. **The governor is untested on real phones until the phone check.** Its thresholds are a first guess, kept in one table.

## Plan stages (for `writing-plans`)

1. **Recipes and the builder:** the schemas and repairs, `build.py` for the four kinds with default motions, `POST /build`, fixtures and the
   wrapper tests. Checkable with Blender alone.
2. **Unity clips:** `AirProgress`, clip selection, the settings parser, the PlayMode tests; rebuild and a manual check of a hand-made recipe.
3. **Build Model with no AI:** the node, the builder service, caches and limits, the Game Template checks, the card and panel, deploy and
   live-check done-criteria 1, 2 (default model), 4, 6, 7 and 9.
4. **Claude:** the three ports and adapters, the design and motion caches, the checking, against the fake; live once the key exists.
5. **Environment:** the scenery builders, Build Environment, the `environment` wire and settings, the template's field, stripes and scenery,
   the renderer budget.
6. **The High quality tier, optimized** (after stage 5, before the final review): the tier in the kit and the checks, the High builders for
   every kind and the scenery, the world builders, the `quality` setting and keys, the lit look and the governor in Unity, the budget tests, and a
   measured rebuild.

## Repository layout

```
blender-worker/       scripts/build.py (builders per kind, motion baking), server.mjs (+ /build, recipe re-check), fixtures/recipes/*.json
web/src/lib/builder/  recipes.ts (shapes, ranges, repair), kinds.ts (the kit: kinds, joints, defaults), keys.ts, service.ts, ports.ts
web/src/lib/ai/       designModel / designMotion / designEnvironment ports, the real adapter, fakes
web/src/lib/graph/    nodes/buildModel.ts, nodes/buildEnvironment.ts, registry.ts (two specs, the environment wire), nodes/gameTemplate.ts
web/src/lib/settings  validateSettings gains the environment object
web/src/app/graphs/   panels, cards and icons for the two steps; the third starter
unity/runner-template Runtime/Sim (AirProgress), Runtime/View (clip selection, environment), Runtime/Settings (environment), tests
fixtures/settings/    environment fixtures shared by both sides
docs/superpowers/notes/  slice6-results.md (after the live checks)
```

## Changes to earlier specs

- **v1 spec:** "AI 3D generation" stays out of scope: here the AI writes bounded data and Blender builds the model. A third node family
  (built models and environments) is added next to uploads and shapes.
- **Blender assets (slice 5):** the worker gains `POST /build`; `prepare.py` and Prepare Model are unchanged (they still remove rigs and
  animations). The cache, limits, deadline and error-code machinery are reused.
- **Describe Game (slice 4):** unchanged; Build Model reuses its picture reader, its limits and its structured-output pattern, and Describe
  Game remains the step that sets the palette and feel.
- **Settings contract (slice 1):** an optional `environment` object and scenery files, an optional `look` and an optional `environment.world`
  are added under schema version 1.

## What only the studio can do (ask before each)

1. Keep the Unity Hub signed in on the build machine so the template can be rebuilt, and say when to rebuild and publish it.
2. For the AI half: the funded Anthropic key and spend limit from slice 4's setup (no new dependency or variable is added by this slice).
3. The phone check: a phone on the same Wi-Fi and an administrator shell, as in slice 1.
