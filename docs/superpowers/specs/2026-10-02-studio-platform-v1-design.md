# Game Studio Platform: v1 design

Date: 2026-10-02. Status: awaiting review. Path: architectural (new project).

## Purpose

An internal tool for a game studio to turn out hypercasual game prototypes quickly. A creator gives a
prompt, reference images and optional 3D assets, wires steps together on a node canvas, and plays a
browser preview of the resulting game. Blender prepares the assets; Unity runs the game.

Audience: the studio's own team first. Opening it to outside creators is a later goal, and this design
must not block it, but nothing for it (accounts, quotas, billing, cloud) is built in v1.

**Done for v1:** a creator wires a graph of about six nodes and plays a browser preview of a runner game
that uses their own 3D model and a palette taken from their reference image. Target: under one minute
from pressing Run on a typical machine.

## Scope: hypercasual, kept simple

One core mechanic per game, one-touch controls, sessions of about a minute, small builds, low-poly or
flat art. Everything below is the smallest thing that meets "done for v1".

## Out of scope for v1

- Accounts, multiple users, quotas, billing, cloud hosting.
- AI 3D generation. Assets come from uploads, or from low-poly shapes the Blender step can make.
- `.blend` uploads (they can embed scripts).
- Native mobile builds (APK/IPA), ads and analytics SDKs.
- More than one game template. A second is added only after the end-to-end flow works.
- Running the Unity Editor on a server.

## Constraint: Unity licensing

Unity's Editor Software Terms, Section 2.1, bar offering the Unity Editor, or processing data with it, to
end users through a cloud or SaaS service without a separate grant from Unity
(https://unity.com/legal/editor-terms-of-service/software, last updated 2026-06-30). Section 2.2 allows
distributing the Unity runtime inside your own games. So the design never runs the Editor on behalf of
creators: the studio builds the templates on its own machine, and the platform only serves the finished
web builds. This was read from a summary of the page; the studio should read Section 2.1 itself before
any public launch. It is not legal advice.

## Architecture

Approach chosen: **pre-built Unity templates with content loaded at runtime.** Rejected: per-game Unity
Editor builds on a server (slow, needs build licenses, hits Section 2.1) and a local companion app
(install friction for every user).

```
Editor (browser) --graph JSON--> Runner --> node executors --> run folder (settings.json + .glb files)
      ^                            |             |                       |
      +------ progress (SSE) ------+             +-- Blender worker      v
                                                 +-- AI executor     Preview: Unity WebGL template
                                                 +-- built-in nodes     loads settings.json + .glb
```

### Units and interfaces

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| Editor | Canvas for building and running graphs; shows progress, errors, preview | Reads and writes graph JSON over HTTP; receives run progress over server-sent events | Runner API |
| Graph store | Saves graphs, uploads and run results on local disk, with SQLite for metadata | Functions: save/load graph, store upload, read/write run folder | Disk |
| Runner | Validates a graph, runs nodes in dependency order, caches results, reports progress | `run(graph) -> run id`; emits events `node-started`, `node-done`, `node-failed`, `run-done` | Graph store, node executors |
| Node executors | One per node type; pure function of inputs and parameters | `execute(inputs, params) -> outputs` | Blender worker, AI executor |
| Blender worker | Runs one headless Blender job from a script and returns a GLB | `prepareAsset(file, params) -> glb` | Blender install |
| AI executor | Turns prompt and image into game settings | `describeGame(prompt, images) -> settings` | A Claude model |
| Unity template | A Unity project built to WebGL that loads a settings file and GLBs at startup | URL parameter `settings=<url>` | glTFast package |

The **game settings file** is the contract between the Runner and the templates. It is versioned
(`schemaVersion`), and only additive changes are allowed within a version.

```json
{
  "schemaVersion": 1,
  "template": "runner",
  "palette": ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"],
  "roles": { "hero": "hero.glb", "obstacle": "obstacle.glb", "collectible": "coin.glb" },
  "tuning": { "speed": 6, "jumpHeight": 2.2, "obstacleSpacing": 12 }
}
```

### Graph and nodes

A graph is a directed acyclic graph saved as one JSON file. Each wire carries one of five data types:
`text`, `image`, `model` (a GLB), `palette` (five colors) or `settings`. The editor refuses to connect
mismatched types.

| Node | Inputs | Output | Executor |
|---|---|---|---|
| Prompt | typed text | `text` | built-in |
| Reference Image | uploaded PNG/JPG | `image` | built-in |
| Asset Upload | uploaded GLB/FBX/OBJ | `model` (raw) | built-in |
| Palette from Image | `image` | `palette` | built-in |
| Describe Game | `text`, `image`s | `settings` (draft: template, palette, tuning) | AI executor |
| Prepare Asset | raw `model`, optional `palette` | `model` (GLB) | Blender worker |
| Game Template | draft `settings`, one `model` per role | `settings` (final, with role files) | built-in |
| Preview | `settings` | playable web preview | built-in |

### Runner behavior

- Runs nodes in dependency order. Independent branches may run in parallel.
- **Cache key** = hash of (node type, node version, parameters, hashes of inputs). A node with an
  unchanged key reuses its stored output, so changing a palette color does not redo the Blender step.
- A failed node reports its error on that node. Nodes that depend on it are skipped. Other branches finish.
- Progress is sent to the editor as server-sent events.

### Blender worker

Each job starts a fresh headless process (`blender -b`) running a script from this project. The script
imports the file, normalizes scale and pivot, reduces triangles to a budget (default 2,000 per asset,
adjustable on the node), applies flat colors or the palette, and exports GLB through Blender's glTF
exporter. Limits: no network, `--disable-autoexec`, a time limit per job (default 60 seconds), and a
maximum input size (default 50 MB).

### Unity template (runner)

One-touch runner: the hero moves forward on its own, a tap makes it jump, obstacles must be avoided and
collectibles picked up. It is a separate Unity project built to WebGL by the studio. At startup it reads
`settings.json`, loads each role's GLB at runtime with glTFast, and applies the palette and tuning.
Targets mobile browsers (iOS Safari 15+, Android Chrome 58+). Web builds have no C# threads or timers, so
the template uses simple frame-based code. Mobile and desktop texture compression differ, so the template
is built once per target and the Preview picks the build by device.

### Preview

The runner writes each run to its own folder holding `settings.json` and the GLBs. The same web server
serves that folder and the template build, so there are no cross-origin requests. The Preview node opens
the template in a frame with the `settings` URL.

### Security

Uploads and prompts are untrusted input.

- Upload allowlist: GLB, FBX, OBJ, PNG, JPG. Size limits are enforced before processing.
- Blender runs with no network, scripts in files disabled, and a time limit. It is given only the
  uploaded file and an empty working folder, with no secrets in its environment.
- The AI step has no tools. Its output is parsed and validated against the settings schema, and rejected
  if it does not match.
- Run folders are addressed by random ids. v1 binds to the local machine or studio network only.

### Error handling

Every failure names the node and the cause in plain words (for example, "Prepare Asset: file is larger
than 50 MB"). Blender time-outs and crashes become node failures, never runner crashes. A settings file
that fails validation stops the run before the Preview opens.

### Testing

- Runner: built test-first with fake node executors. Covers ordering, caching, failure skipping and
  event sequence.
- Blender scripts: run headless against small sample files in a `fixtures/` folder. They assert triangle
  count, bounds and a valid GLB.
- Settings schema: tests with valid and invalid examples shared by the Runner and the template.
- Unity template: a smoke test scene that loads a sample `settings.json` and GLB; checked by hand in a
  desktop browser and a phone.
- Editor: end-to-end checks in a real browser for building a graph, running it and seeing an error.

## Proposed stack

TypeScript throughout. React with React Flow for the editor. A small Node server for the API, runner and
static files. SQLite plus local folders for storage. Blender via its command line. Unity (current LTS)
with the glTFast package. These choices are open to change during planning if a slice shows a problem.

## Build order

Each slice gets its own plan and review.

1. **Unity runner template** that loads a hand-written `settings.json` and a GLB in a WebGL build. This
   proves the riskiest part: runtime loading, build size and mobile performance.
2. **Blender Prepare Asset** as a command-line script with fixtures.
3. **Runner** with the settings schema and cache, driven by graph JSON files.
4. **Editor** on top of the runner.
5. **Describe Game** (AI) and Palette from Image.
6. Later, if wanted: a second template, export of a ready-to-build Unity project for local mobile builds,
   then accounts and publishing for outside creators.

## Prerequisites (this machine, checked 2026-10-02)

Not found in standard locations: Node.js, Python, Blender, Unity Hub and Unity Editor. Before slice 1 the
studio needs Unity (current LTS, with the WebGL module) to build the template, and before slice 2
Blender. Node.js is needed from slice 3. Nothing is installed without asking.
