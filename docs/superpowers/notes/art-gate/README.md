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
