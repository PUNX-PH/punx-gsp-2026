# Art gate (slice 9, Task 1), 2026-10-09

Five reference models, each as good as the CURRENT kit (High) can make it, built by `blender-worker/scripts/build.py` and rendered by `blender-worker/tools/render-preview.py`
(Cycles, CPU, one sun, a plain floor, the same camera for all). Recipes: `blender-worker/fixtures/recipes/art/` (made by `tools/make-art-recipes.mjs`); rerun with
`node blender-worker/tools/art-gate.mjs`.

| Model | Triangles | Parts | GLB | What it looks like |
|---|---|---|---|---|
| fox hero (biped) | 7,752 | 60 | 229 KB | **Not a fox.** The biped template is a robot-like character; the tail is missing and the "ears" float as two capsules |
| robot enemy (biped) | 8,396 | 79 | 261 KB | Reads as a robot, tidy and flat-shaded; the kit's best case |
| wooden crate (prop) | 980 | 14 | 41 KB | A neat crate, but flat color: no wood grain, no texture |
| forest pine (scenery) | 174 | 6 | 11 KB | Plainly low-poly cones; no needles, no bark, no variation |
| spaceship (vehicle) | 1,960 | 28 | 67 KB | **Reads as a toy car**, not a ship: the vehicle kind has a rectangular body and wheels |

**Finding:** the current kit makes clean, stylised, mechanical shapes. It cannot make organic bodies (fur, tails, ears, curved hulls), has no textures or surface detail, and its four kinds fix the silhouette.
The triangle counts are well inside the current caps (biped 12,000, vehicle 6,000, prop 3,500, scenery 1,500), so the limit is the *vocabulary*, not the budget.
That is what Tasks 2 and 3 are for: revolve, loft, mirror and blob parts; smooth surfaces and bevels; PBR materials with baked procedural textures; then the budgets per target.

## Round 2: the freeform vocabulary (same day)

`blender-worker/scripts/freeform.py` is a new recipe kind, `model`: a list of parts (ellipsoid, capsule, cylinder with taper, box with bevel, torus, lump, tube along a path, revolve,
loft of cross-sections, each with position, size, rotation, a material index and an optional mirror), checked as data before anything is built. The five test models above are hand-written
**fixtures to prove what the vocabulary can express**; in the product the person's prompt makes Claude write such a recipe, so there are no presets. Pictures: `v2/`.
Recipes: `blender-worker/fixtures/recipes/freeform/` (made by `tools/make-freeform-recipes.mjs`); build one with `blender -b -P tools/freeform-build.py -- recipe.json out.glb`.

| Model | Triangles | Vertices | Reads as |
|---|---|---|---|
| fox | 10,950 | 5,635 | A fox: snout, ears, cream chest, tail with a tip, paws |
| robot | 6,430 | 3,874 | A toy robot with a visor, plates, bolts, joints |
| crate | 3,504 | 2,944 | A wooden crate: planks, iron frame, nails |
| pine | 4,160 | 2,624 | A tiered pine with boughs |
| spaceship | 3,672 | 2,207 | A ship: lofted hull, canopy, swept wings, fins, twin engines |

All are inside the plan's PC budgets (hero 15,000; prop 5,000; scenery 8,000), but the fox (10,950) is over the mobile hero budget (5,000): the mobile variant (decimation, fewer segments
via `detail`) is Task 6, and the worker enforcing the budget by the real count is Task 4.
