# Slice 6 spikes: rigged models, clips and environment (2026-10-06)

Evidence for `docs/superpowers/specs/2026-10-06-built-models-design.md`. Both spikes were throwaway: the Blender scripts ran from a scratch
folder and the Unity work was a copy of the template at `C:\dev\unity-spike` (about 2.1 GB, safe to delete). Nothing in this repository
changed. The code is not kept; the findings are.

## Spike 1: can headless Blender build a rigged, animated GLB with no one in the loop?

Run on Blender 5.2.2 LTS (`blender -b --factory-startup`).

- Input: a deliberately messy humanoid, 16 overlapping primitive shells joined into one object (590 vertices, 1,116 triangles). A fixed
  17-bone skeleton and three clips (Run 1 s loop, Jump, Idle) written once against it.
- Result: one GLB of about 155 to 160 KB (two runs) with 1 mesh, 1 skin of 17 joints, joint indices and weights, and 3 named animations. It re-imports cleanly.
  The skin really deforms: vertices moved up to 0.55 m across the Run clip.
- Blender's automatic weights alone left 8 vertices with no weight on this overlapping mesh. A fallback (skin a voxel-remeshed copy, then
  transfer the weights back by nearest surface point) brought it to 0. A naive version would have shipped a broken rig.
- The same humanoid as **rigid parts** (16 meshes under 17 joint nodes, no skin, node animation) exports at about 97 to 99 KB with animation channels
  only on the joints a clip moves (7, 7 and 2 channels against 51 per clip when skinned).

## Spike 2: does the Unity template play it?

Copy of the template, patched with logging, a clip selector and an auto-jump; Unity 6000.3.25f1, glTFast 6.20, WebGL, served locally and run in the
Claude desktop app's browser pane. Batch builds need an active Unity Hub sign-in: the first attempt failed with "No valid Unity Editor
license found" until the studio signed in.

| Check | Result |
|---|---|
| The cloned hero keeps its legacy `Animation` and clips | Yes: `Run, Jump, Idle`, for the skinned hero and for the rigid-part hero |
| Run switches to Jump on take-off and back on landing | Yes, with the clips overlapping during a 0.08 s crossfade |
| The skeleton really moves in the player | Left and right feet swing in opposition (about 0.24 to 0.31 m along the run direction); the hand swings about 0.17 m |
| Skinned and rigid designs behave the same | Yes, within about 2 cm on every probe |
| Release build (Brotli, High managed stripping) | Skinned hero identical to the Development build; the build is 7.74 MB against the 15 MB budget |
| Pooled prop clips (a coin) | Keeps spinning as clones are re-activated |
| Environment: wide field, edge stripes, pooled scenery (tree sway, windmill spin) | Works; the windmill hub turns about 122 degrees per 0.13 s sample and the canopy sways about 4 degrees either side |

## Findings that shape the design

1. **Prefer rigid parts, joined into one mesh per joint, for built models.** No weights, no weighting fallback, smaller files, identical
   playback. Skinning is only needed for single-mesh imports, which are out of scope.
2. **Drive the Jump clip from the sim's progress through the jump.** Airtime is `2 * sqrt(2 * 30 * jumpHeight) / 30` seconds, about 0.77 s at
   the default jump height, and it moves with the tuning. A free-running clip of fixed length finished early and held its last pose while
   the hero was still rising.
3. **Keep the renderer count down.** The environment with unjoined parts gave about 170 active renderers, too many for a phone. One mesh
   per joint and one mesh for the stripes should roughly halve it.
4. The template change is small (about 15 lines for clip selection, plus the environment).
5. The model-fit footprint cap (hit-window width) must not apply to scenery.

## Not tested

A real phone; the mobile (ASTC) build; frame rates (the browser pane ran the game about 2.6 times slower than real time, so the debug fps
is not a measurement); a rigid-part hero or the environment on a release build; Idle; hit, collect or game-over reactions.

## Mistakes made on the way (so nobody repeats them)

- The first foot probe logged the position relative to its parent bone, which does not change when the parent rotates. Probe positions
  relative to the model's root.
- A log interval that divides the loop length (2 s against a 1 s loop) made a spinning prop look still. Sample at an interval that does not.
- Rotating an arm about its own long axis twists it without swinging it; swing about the axis perpendicular to the bone.
