# Slice 9: the art pipeline (budgeted detail, richer models, sprites for 2D) — design

Status: draft for review (2026-10-08). Replaces "low-poly and flat" with "as detailed as the target device can afford", and adds 2D art. Builds on slice 6's Blender builder and slice 8's player.

## Purpose

A creator's idea becomes models, or sprites, that look **good**, not blocky, and still run well on the device the game is built for. Success: for each of five different descriptions (a fox hero, a robot enemy, a wooden crate, a forest, a spaceship) the platform makes a model a person
would not call low-poly, inside its triangle budget on PC and on a mid-range Android phone, with a 2D sprite version for 2D games, and the numbers are shown on the card.

## What changes from slice 6

| Slice 6 (today) | Slice 9 |
|---|---|
| Models are rigid primitive parts, flat colors, caps of 600 to 2,000 triangles; a High tier adds finishes and bevels | Detail is set by a **budget per target** (below); surfaces are smooth, shapes are organic when the idea is, materials and textures are generated |
| One GLB per model | **Two variants** from one build: PC and mobile (Android, and the mobile WebGL build), plus levels of detail |
| 3D only | **3D models and 2D sprites** from the same recipe |
| The recipe kit is fixed in `kit.json` | The kit grows (smooth surfaces, more shapes, materials, textures), still data, still checked twice |

## Constraints (carried over)

- **Data, never code.** Claude writes a recipe in a fixed schema; the web app repairs it; the worker repeats every check; Blender runs only our own scripts on the checked recipe. The worker stays private, with no secrets and a throwaway folder per job.
- Blender builds the art, Unity runs it, the player is pre-built; no Unity Editor on a server.
- Cache keys include the target and the version, so old results are never reused for a changed pipeline (`JOB_VERSION` bumps with any change to a Blender script).
- Smallest thing that works: each new part of the kit exists because a described thing needs it.

## Budgets per target

Proposed defaults, to be measured on real devices in the first milestone and then fixed in `kit.json` (`tiers`), where the High tier's numbers already live:

| | PC | Android (mid-range phone from about 2021) and mobile WebGL |
|---|---|---|
| Hero or main character | 15,000 triangles | 5,000 |
| Enemy, prop, collectible | 5,000 | 1,500 |
| Scenery piece or world piece | 8,000 | 2,500 |
| Everything on screen at once | about 250,000 | about 80,000 |
| Texture size (any side) / textures per model | 2048 / 3 | 1024 / 2 |
| Materials per model | 4 | 3 |

The worker **enforces** a model's budget as it does today (the real counts of the exported GLB, within a tolerance of the estimate); a recipe that cannot fit drops detail in a fixed order, then fails with a plain message. The quality governor generalizes the slice 6 one:
on a device that cannot keep its frame rate it steps the game's own detail down (levels of detail, then shadows and fog, then scenery density).

## A richer kit (the Blender builder, version 2)

All of it is chosen by Claude as data from this list, never as Blender code:

- **Surfaces:** subdivision with creases, smooth shading with a normal-angle limit, bevels, and a thickness for flat parts.
- **Shapes:** the existing parts plus revolve (a profile around an axis: vases, bottles, hulls), loft (a profile along a path: tails, tubes, wings), mirrored limbs, and an organic blob (a subdivided sphere with a few displacement controls) for creatures and rocks.
- **Materials:** physically based parameters (base color, roughness, metallic, emission) from the palette, plus **procedural textures baked into one small atlas per model**: noise, gradients, stripes, panel lines, wear and ambient occlusion. UVs are made by the worker's own unwrap.
- **Rigs and clips:** as slice 6 (rigid parts on joints, node-track clips); a smoothly bending creature is a **decision for the plan** (skinned meshes need skinning support in the player's loader and a budget for bones; the first version may keep rigid parts with hidden joints).
- **Scenery and world:** the same kit builds scenery and the High world pieces, so a forest and a spaceship come from one vocabulary.

## Variants and levels of detail

One build produces, from the PC-quality mesh: the **PC variant** (the budget above) and a **mobile variant** (Blender's decimate to the mobile triangle budget with the silhouette preserved, textures resized, materials merged), and **two levels of detail** per model (50% and 15% of the triangles) as separate meshes in the same GLB.
The run holds both variants (`entity-NAME.glb` for PC, `entity-NAME.mobile.glb`); the player picks by platform. **Export keeps only the variant its target needs**: the Windows zip carries the PC files, the Android APK the mobile files. Compression of meshes (meshopt or Draco)
is decided only if measured download sizes need it: it adds a library to the worker and the player.

## 2D art

For a game with a `2d` camera, Claude's asset request says `view: "sprite2d"`. The worker **renders the same model from an orthographic camera** into a sprite sheet: a fixed set of views (side, top, or eight directions as asked) times the frames of each clip, packed into one atlas (at most 2048 on PC, 1024 mobile), with a small JSON
(frame rectangles, pivots, frames a second, loop flags) beside it. A flat shape (a bar, a tile, a button) is a `quad` in the script and needs no sprite. The player draws sprites as textured quads with its own shader and plays the frames from the sheet.

## Making it (web side)

- Asset requests gain `style` (realistic, stylized, cartoon, painted, flat), `detail` (hero, prop, background, which picks the budget class) and `view` (`3d` or `sprite2d`). The prompts and schemas are built from the kit's table, as today. Each schema stays **small** (the API refused a large one in slice 7); detail lives in the prompt and in checks, not in the schema.
- Build Model and Build Environment settings gain **Target** (`PC` or `Android`, default both) next to Quality; the card shows triangles, textures, file sizes and the two variants. Describe Game's own asset requests use the game's targets.
- The Standard and High settings of slices 6 and 7 keep their meaning: Standard stays small and flat as today (it is the cheap path), High is the first rung of the new pipeline.

## Unity side

The player loads the platform's variant, chooses levels of detail by distance and by the governor's level, draws sprite sheets, and reads the budgets from the settings file. Materials come from the GLB (PBR through glTFast) and the existing lit shaders are extended, not replaced.

## Tests

- **Blender (the 66-test file grows):** every new kit part builds and fits its budget; the budget enforcement and the drop order; UVs exist and do not overlap; atlas sizes; the mobile variant is under its budget and keeps the bounding box within 5%; levels of detail have the stated ratios; sprite sheets have the stated frames; bad recipes are refused by the worker as well as the web.
- **Web (Vitest):** recipe checks and repair for the new kit, keys that include target and version, the prompts built from the kit table, the settings, the cards, and the export's file choice per target; mutation checks as in slice 6.
- **Unity:** both variants load, the platform chooses the right one, levels of detail switch, a sprite sheet plays and loops; frame rate and load time are **measured on a phone** (the acceptance numbers come from there).
- **By eye** (the only way): the five descriptions above, on PC and a phone; whether the models read as "not low-poly" is the creator's judgement, recorded in the results note with screenshots.

## Risks and open points

- **Whether a recipe kit can look good enough** is the central risk. The first milestone makes five reference models by hand-written recipes to see the ceiling before any prompt work; if they look blocky, the kit grows or the approach changes before the rest is built.
- **Worker time and cost:** baking textures and rendering sprites take longer than slice 6's builds (a cold Cloud Run start plus a bake may pass the current 60 s job limit and 2 Gi memory); the plan measures it and raises the worker's CPU, memory and timeout, and the Play budget accounts for it. More models per game means more Blender jobs: the cap of six per game is a cost control.
- **Storage:** two variants and sprite sheets grow what each graph stores; run files are already cleaned up after an hour for pending runs and replaced per graph.
- **Android heat and memory** are only known on a phone; the budgets are provisional until measured.
- **Skinned characters** (above) and **mesh compression** are open and decided at the plan with numbers in hand.
- **Unity cannot run today**: the Unity side and the phone measurements wait for the Hub sign-in; the Blender and web work can be built and tested first (Blender 5.2 is installed here).

## Build order (one plan, milestones)

1. **Measure and look** (Blender here, a phone later): the budget table measured, five reference models by hand-written recipes, a look judgement. A gate.
2. Kit v2: smooth surfaces, the new shapes, schema and checks on both sides, the budget enforcement.
3. Materials, procedural textures, UVs and the atlas.
4. Variants and levels of detail (decimate, texture resize, merged materials), the run files and the export's file choice per target.
5. The sprite renderer in the worker and the sprite sheet format.
6. The web side: asset requests with style, detail and view, the Target setting, the prompts and schemas, the cards.
7. The Unity side: variant choice by platform, levels of detail, sprite drawing, the generalized governor.
8. Phone and PC measurements, live acceptance by eye, the results note.

## Not in this slice

Turning a picture into a 3D model, user-uploaded textures or hand-made models beyond today's Prepare Model, sound, terrain sculpting, character customization UI, and a texture painting tool.
