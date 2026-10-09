# Slice 10: generate everything from the prompt (no templates, no premade pieces)

**Owner's rule (2026-10-09, third time):** the person prompts; the platform generates the models, characters, environment and code, 3D or 2D as the idea implies, and shows it in the preview. Nothing premade or template-shaped in what the person sees; the platform attaches quality itself.
Decisions (2026-10-09): **3D only for now** (owner: "to make things easy lets generate only 3D"): every game is 3D whatever the idea says (a request for 2D or flat is made as the 3D equivalent: a side view is the side camera); 2D and sprites are a later slice. **World** = Claude composes it per game, as freeform models. **Editor** = the generated graph is a read-only "how it was made" view, with no Game Template.

## Design

One Claude call (the script call, enlarged) answers `{ script, palette, leftOut, assets, style, world }`:
- `style` (realistic, stylized, cartoon, painted, flat): one look for every model of the game.
- `world`: `{ sky, ground, scenery: [{ description }] }`: palette slots for the sky and the ground, and up to four pieces of scenery described in words (a snowy pine, a neon sign, a market stall).
- `assets` no longer carry a kit `kind`: every model is freeform.
- Always 3D: the prompt allows only the 3D cameras (top, chase, fixed, side); it says to follow the idea's genre, not an example's.

The generated graph: Describe Game (the plan and the code) feeds one **Build Model** per asset and one **Build World** (the scenery as freeform models, plus the sky and the ground), which feed **Assemble Game** (the old Game Template, renamed, with no runner wording) and the Preview. Models and scenery are built for PC and phone.
The player: a made game is always lit; the scenery stands beyond the field edge in the ground cameras (done in `ScriptView.SetWorld`).

## Tasks

1. **The answer**: schema and prompt carry `style` and `world`, drop the kit `kind`; the service checks and repairs them; `SCRIPT_VERSION` 4. Tests.
2. **Style in models**: `BuildModelInput.style`, the freeform design prompt and key take it; Build Model has an optional `style` setting. Tests.
3. **Scenery as freeform**: `BuilderService.buildScenery` (role scenery, PC and phone, no clips). Tests.
4. **Build World node**: `build-world` (params: sky, ground, style, scenery descriptions, soft), output the `environment` wire with custom pieces and their phone files. Tests.
5. **Assemble Game**: the template carries the world and the phone files of scenery into the settings and the run; renamed from Game Template everywhere the person reads it. Tests.
6. **The generated graph** uses Build World and passes style; Make it passes the plan's world. Tests.
7. **3D only in the prompt**: no 2D cameras, three 3D examples of different genres. Tests.
8. **Whole flow test** with a scripted designer and a fake worker (prompt in, graph run, run files), docs, memory; rebuild and publish the WebGL template; push on the owner's word.

## Not in this slice
2D games and sprites, textures, LODs, the rules engine path (kept for old games), the read-only editor mode itself (the graph is generated; locking it is a UI task for later), real-Claude tuning (needs a look at live output).
