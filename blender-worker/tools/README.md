# blender-worker/tools

The scripts that produce the High tier's numbers and its recipe fixtures. They are run by hand when a builder (`scripts/high.py`, `scripts/world.py`,
`scripts/build.py`) changes, so that the kit's numbers stay what Blender really builds. Nothing here runs in the worker or the web app.

Order, from the repository root (Blender 5.2 on this machine, Node 24):

1. **Measure** what Blender builds: `blender -b --factory-startup --python-exit-code 1 -P blender-worker/tools/measure-high.py -- measured.json`
   writes the triangles, vertices, parts and meshes of every kind's base, extras and details, every prop shape and every scenery piece (the world
   pieces are measured by building them: see the Blender tests). A cost is a difference of two builds in that file.
2. **Edit the numbers** in `tiers-table.mjs` (the caps, the finishes, the defaults and the measured counts).
3. **Write them into both copies of the kit** (`scripts/kit.json` and the typed literal in `web/src/lib/builder/kinds.ts`):
   `node blender-worker/tools/write-tiers.mjs`. It is idempotent; a test keeps the two copies equal.
4. **Regenerate the recipe fixtures** (`fixtures/recipes/high/`, with `expected-high.json`): `bash blender-worker/tools/regen-high-fixtures.sh`.
5. **Rebuild the real-output GLBs** the web tests and the Unity samples use: the commands are in `../README.md` ("The web app's fixtures"); the Unity
   sample `unity/runner-template/Assets/StreamingAssets/sample-world-high` is built from the same recipes (hero from `biped-high-default.json`, obstacle
   from `vehicle-high-default.json`, coin from `prop-high-default.json`, scenery from `scenery-{tree,windmill,rock}-high.json`, the world from
   `world-{terrain,road,backdrop}-desert.json`).
6. Run the worker tests, the Blender tests and the web tests: they check the kit against the real builds (estimates within 10 percent, the world's within
   its bounds, real counts within the caps).
