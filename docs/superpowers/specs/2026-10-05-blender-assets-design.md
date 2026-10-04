# Slice 5: Blender assets (Prepare Model and Make Shape)

Date: 2026-10-05. Status: awaiting review. Path: architectural (a new subsystem and a new host). Builds on the graph engine
(`2026-10-03-graph-engine-design.md`), the node canvas (`2026-10-04-node-canvas-design.md`) and Describe Game
(`2026-10-04-describe-game-design.md`), all live at https://punx-gsp.vercel.app (slice 4's AI call is deployed but parked until the
studio has API funds). The v1 spec (`2026-10-02-studio-platform-v1-design.md`) planned this slice as "Blender Prepare Asset"; this spec
settles it and adds shape-making.

## Purpose

Today a game's hero, obstacles and collectibles are built-in shapes, unless the person uploads a GLB that is small and already
game-ready. This slice gives them two ways to get better models without leaving the canvas:

- **Prepare Model** takes a model the person uploaded (GLB, FBX or OBJ) and makes it game-ready with Blender: the right axes, a small
  triangle count, flat colors (optionally one color from the palette), nothing else in the file.
- **Make Shape** builds a low-poly shape (cube, sphere, cone, cylinder, pyramid, coin, ring) in a chosen color, so a game can have its
  own look with no upload at all.

Blender cannot run on Vercel, so it runs in a small private container on Cloud Run, and Play calls it the way slice 4's Play calls
Claude: inline, with a cache and daily limits. The step that lets the AI choose the shapes from a prompt is a later, small follow-up
(it needs API funds to be checked live).

**Done for this slice** (each is a check on the live site):

1. Signed out, nothing can reach the worker (every graph page and API call is still refused, and the worker itself refuses a call that
   has no token: `curl` on its address gives 403).
2. A person uploads an FBX or OBJ to a 3D Model step, wires it through Prepare Model into a game's hero slot, presses Play, sees the
   triangle counts and the file size on the card, and plays a game with that hero.
3. A person adds a Make Shape step (for example a sphere in swatch 4), wires it into the collectible slot, presses Play, and plays a
   game with that shape.
4. Pressing Play again with nothing changed shows "Reused your earlier result" on both steps and makes no new worker call.
5. Plain refusals, each on the step: a raw FBX or OBJ wired straight into Game Template, a model with no 3D shape in it, a broken
   file, a model that takes longer than 60 seconds, the daily limit, the worker not answering, and Play running out of time.
6. Covered by tests: the Blender scripts on fixtures (triangle count, bounds, Y-up, flat materials, a valid GLB), the cache key, the
   limits and the deadline.
7. No secret is in the repository, the worker's key exists only in Vercel, the worker is private, and the Cloud Run bill is readable in
   the Google Cloud console.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| What Blender does | Both: prepare an uploaded model, and make low-poly shapes. Prepare first | Matches the v1 spec (Prepare Asset) and the studio's wish that a prompt can end up making assets; shape-making needs no upload. |
| Who picks a shape | The person, in a Make Shape step. Describe Game choosing shapes from the prompt is a later follow-up | Shapes can be checked live now; the AI half cannot until there are API funds (slice 4 is parked). The seven shapes are a fixed list the AI can pick from later. |
| Where Blender runs | A container on Cloud Run in the existing Firebase/Google Cloud project, private, scale to zero | Always available, no machine to keep on, and pay-per-use (expected inside the free tier at studio volumes; the figures are to be confirmed in the plan). Rejected: a worker on a studio PC (only works while the PC is on); Node-only clean-up on Vercel (weak FBX/OBJ conversion, and it drops the project's "Blender prepares the assets" decision). |
| How Play uses it | Inline and cached, no queue | Jobs are capped at 60 s, so Play can wait for them (Vercel runs functions for up to 300 s). The queue slice 4's spec expected for Blender is not needed: a re-Play resumes from the cache. |
| Normalising scale | Not done in Blender | The Unity template already fits every model to a target height and stands it on its base centre (`ModelFit.cs`). Blender fixes the axes, not the size. |
| Upload size | Stays 4 MB | Vercel's request-body limit is about 4.5 MB. The v1 spec's 50 MB would need direct-to-storage uploads, a separate feature. The worker's own cap is 32 MiB (Cloud Run's HTTP/1 request limit, to be confirmed in the plan) so a later upload route needs no worker change. |
| Animations | Not supported in v1 | Models are static; rigs and animations are dropped (the card does not say so in v1). |

## Out of scope for this slice

Describe Game choosing shapes (follow-up); direct-to-storage uploads above 4 MB; `.blend` files; animations and rigs; textures
(materials become flat colors); a 3D viewer on the card; a job queue; parallel nodes in Play; several Blender worker regions; a
network with blocked internet egress for the worker (listed as optional hardening); a third starter graph.

## What the person sees

- **3D Model** now accepts GLB, FBX and OBJ (still no `.blend`). The kind is decided from the file's first bytes. A raw FBX or OBJ
  wired into Game Template is refused in plain words: "Game Template: the hero model is an FBX file. Put a Prepare Model step after
  it." A GLB can still go straight in.
- **Prepare Model** (new): a `model` wire in, an optional `palette` wire in, a `model` wire out. Settings: the triangle budget
  (default 2,000, from 100 to 5,000) and the color: "Keep the model's colors" (default) or one of the five palette swatches (the
  wired palette's, or the sample palette's with none wired). The card shows plain facts: "9,400 triangles to 2,000, 41 KB, flat
  #ff6f59", and "Reused your earlier result" when the cache answered.
- **Make Shape** (new): an optional `palette` wire in and a `model` wire out. Settings: the shape (seven buttons with their names) and
  the swatch (default swatch 4, which the Unity template does not use for its own text). The card shows the shape and the swatch.
- Both are in the Add menu and the wire is the same `model` wire as today. The starters do not change.
- Failures show on the step in plain words and the steps after it are skipped, like any other step.

## Architecture

```
Play (Vercel) -> Prepare Model / Make Shape -> cache hit? -yes-> stored GLB
                         | no
                         v
   Cloud Run "blender-worker" (private): one fresh `blender -b` per job -> GLB
                         |
                         v
   stored in the graph's own folder, found by its SHA-256 -> Game Template -> Preview
```

### The worker (`blender-worker/`, new folder)

A small Node HTTP wrapper in a container with Blender and the libraries headless Blender needs, plus two Blender Python scripts.

| Endpoint | In | Out |
|---|---|---|
| `POST /prepare?format=glb\|fbx\|obj&triangles=N&color=original\|#rrggbb` | the raw file as the body (up to 32 MiB) | 200 and the GLB, with `X-Triangles-Before` and `X-Triangles-After`; or an error `{ "error": "<code>" }` |
| `POST /shape` | `{ "shape": "...", "color": "#rrggbb" }` | 200 and the GLB; or an error |
| `GET /healthz` | nothing | 200 (no Blender run) |

Error codes: `too-big` (413), `bad-format` (415), `empty` (422, no 3D mesh), `timeout` (504), `failed` (500). The worker returns codes
only, never Blender's log or a sentence; the Vercel side words them.

**`prepare.py`** (run as `blender -b --factory-startup --disable-autoexec -P prepare.py -- in out ...`):
1. Start from an empty factory scene; import by the format given (glTF, FBX or OBJ importers).
2. Keep meshes only and join them into one object; drop cameras, lights, rigs and animations; apply all transforms.
3. Triangulate; if over the budget, decimate (collapse) to the budget; the result never exceeds it.
4. Flatten materials to base colors (textures dropped); with a color given, every face gets that one flat color.
5. Export GLB with Y-up and no extras (no cameras, lights, animation, extra UV sets or vertex colors that Unity ignores).

**`shape.py`**: builds one of cube, sphere (low-poly icosphere), cone, cylinder, pyramid, coin (a thin cylinder) or ring (a torus) at
unit height, one flat color, same export.

The wrapper decides nothing about the file from its name. It writes the body to a throwaway folder, runs Blender as an unprivileged
user with no secrets in its environment and a 60 s kill timer, reads the result file, and deletes the folder.

### The calling side (Vercel, `web/src/lib/blender/`)

- `types.ts`: `BlenderService` with `prepare(user, graphId, input, params)` and `shape(user, graphId, params)`, each returning a model
  wire value and a result (`reused`, triangle counts, size). The service is the one place the rules live, like `makeDescribeGameService`.
- `client.ts`: calls the worker with a Google ID token minted from a dedicated service account that has only the invoker role on the
  worker (`BLENDER_WORKER_URL`, `BLENDER_WORKER_KEY`, both read when a job is asked for, never at import or build time). It uses
  `google-auth-library`, which `firebase-admin` already brings in; it becomes a direct dependency (installing needs the studio's yes).
- `key.ts`: the cache key is the SHA-256 of `JSON.stringify([JOB_VERSION, kind, params, resolved color, input SHA-256, graph id])`. The
  resolved color is the hex the swatch picks from the wired palette, so a palette change reruns the step only if its color changed.
  `JOB_VERSION` is bumped whenever a Blender script or the worker's output changes.
- Ports and adapters, as slice 4: `JobCache` and `UsageLimits` ports, in-memory fakes for tests, Firestore adapters
  (`blenderOutputs/{key}`; limit counters in their own documents with their own prefix, so they never collide with slice 4's).
- Derived files: the GLB a job produced is kept at `graphs/{graphId}/derived/{sha256}` in Cloud Storage and removed with the graph (the
  graph's whole folder is already deleted with it). The execution context's `readAsset` reads a graph's uploads and then its derived
  files, so Game Template and Preview do not change. A cache record whose file is gone counts as a miss.
- The `model` wire value gains `format: "glb" | "fbx" | "obj"`, `AssetInfo` gains an optional `format` (missing means GLB, as today), and the
  uploads route accepts FBX and OBJ, decided from the first bytes. Game Template refuses a non-GLB (Preview only receives GLB sources from it).

### The rules the service keeps

- A cache hit costs nothing and uses no count. Otherwise the count is taken before the call.
- It is given back if the worker never answered (down, auth failure, timeout of the call itself); it is kept when Blender ran and
  refused the file (that cost compute).
- Limits per UTC day: `BLENDER_DAILY_LIMIT_PER_PERSON` (default 60 new jobs) and `BLENDER_DAILY_LIMIT_TOTAL` (default 600); `0` means
  nobody; junk falls back to the default.
- A cache-write failure does not fail the step (the file is good and was paid for); it is logged.
- Logs carry the step, the outcome, counts and the worker's HTTP status; never a file, a name or Blender's output.

### Play's time budget

Play runs steps one at a time in one request (limit 300 s: `maxDuration` is already 300). Up to six Blender jobs and a Describe Game
call could pass that, so Play sets a deadline 270 s after it starts (`ExecutorContext.deadline`).

- Each worker call's timeout is the smaller of 65 s and the time left.
- A step that cannot start with at least 10 s left fails with "Prepare Model: Play ran out of time. Press Play again; finished steps
  are kept, so it carries on."
- Describe Game's call timeout is capped the same way (a one-line change to slice 4).
- `lib/blender/duration.test.ts` holds the constants in order, like slice 4's `duration.test.ts`.

## Security

Uploads are untrusted input, and now they are given to a program that parses complex formats.

- The worker is private: unauthenticated calls get 403 from Cloud Run itself. The invoker service account has no other role, so a leaked
  key can run Blender jobs and nothing else. Max instances 2 and concurrency 1 cap cost and abuse; the daily limits cap it again.
- The file's kind comes from its bytes. FBX, OBJ and GLB are data formats, and `--disable-autoexec` plus a fresh `--factory-startup`
  mean no script from a file runs. `.blend` stays refused because it can embed scripts.
- Each job runs in a throwaway folder as an unprivileged user, with no secrets in its environment, 2 GiB of memory, and a 60 s kill.
  The container's own service account has no permissions.
- The v1 spec's "no network" is only partly met: a Cloud Run container can reach the internet unless the studio adds a locked-down
  network. Nothing in a job uses the network and no secret is present, so this is optional hardening, listed in the handoff.
- Prompts are not involved, so nothing here goes to a third party: files go to the studio's own Google Cloud project.

## Error handling

Every failure names the step and the cause in plain words, never Blender's log:

| Cause | Sentence |
|---|---|
| FBX/OBJ wired straight into a game | "Game Template: the hero model is an FBX file. Put a Prepare Model step after it." |
| `empty` | "Prepare Model: this file has no 3D shape in it." |
| `bad-format` or unreadable | "Prepare Model: this file could not be read as a GLB, FBX or OBJ." |
| `too-big` | "Prepare Model: larger than 32 MB." (uploads stop at 4 MB first) |
| `timeout` | "Prepare Model: this model took longer than 60 seconds. Try a simpler one." |
| worker down, auth, 5xx | "Prepare Model: The Blender service did not answer. Try again." |
| limit | "Prepare Model: you have used today's 60 Blender jobs. Try again tomorrow." |
| no time left | "Prepare Model: Play ran out of time. Press Play again; finished steps are kept, so it carries on." |

## Testing and acceptance

- **Node side, test-first with fakes** (no Blender needed): the file-kind reader for FBX and OBJ (and hostile near-misses), the client
  against a fake `fetch` (token, timeout, each error code), the service (cache hit, limits taken and given back, the error table), the
  two executors, the Game Template refusal, the cache key, the deadline arithmetic and the constants test.
- **Blender scripts, on fixtures** (`blender-worker/fixtures/`): a cube OBJ, a Z-up FBX, a GLB, an empty scene, a broken file and a
  huge-triangle OBJ. They assert triangle count within budget, bounds, Y-up, flat materials and a GLB that re-imports. They need Blender
  installed on this machine (or the image).
- **The container**: a smoke test builds the image and runs a fixture through the wrapper.
- **Unity**: no change. One manual check that a prepared GLB plays in the Preview.
- **Editor**: `renderToString` tests for the two panels and cards, as in slices 3b and 4.
- **Live acceptance**: the seven done-criteria above, in a real browser on the live site, after the setup below.

## Risks

- **Unproven until the worker exists:** the real Cloud Run call and its auth, cold-start time (expected 10 to 20 s), Blender's memory on
  real FBX files, FBX versions (binary only: an ASCII FBX is refused at upload) and the Firestore and Storage adapters.
- **FBX is the weak format.** Blender's importer is good but not perfect; some files will fail. The spec's answer is the plain sentence
  above and, for those, GLB or OBJ.
- **A very large input can still fill memory inside 60 s.** The 4 MB upload cap makes this unlikely; a decompression-style OBJ is the
  case the huge-triangle fixture covers.
- **Derived files pile up** when inputs change often. They are small (a 2,000 triangle GLB is about 100 KB) and are removed with the
  graph; a cleanup of unused ones is a later minor.
- **Cost:** pay per use and expected to stay inside Cloud Run's free tier for a studio; the plan confirms the figures against current
  pricing, and the studio sets a budget alert on the project.

## What only the studio can do (ask before each)

1. Install Blender on this machine for the fixture tests.
2. Build the image: Docker here, or Google Cloud Build.
3. In the existing Google Cloud project: enable Cloud Run, Cloud Build and Artifact Registry; create the worker service (private) and an
   invoker-only service account with a key; add `BLENDER_WORKER_URL` and `BLENDER_WORKER_KEY` (Sensitive) in Vercel, then redeploy.
4. Set a budget alert on the project.

## Repository layout

```
blender-worker/            Dockerfile, server.ts (the wrapper), scripts/prepare.py, scripts/shape.py, fixtures/, tests
web/src/lib/blender/       types.ts, client.ts, key.ts, ports.ts, memory.ts, firebase.ts, service.ts, server.ts (wiring)
web/src/lib/graph/nodes/   prepareModel.ts, makeShape.ts (new); model.ts, gameTemplate.ts, preview.ts (small changes)
web/src/lib/graph/         registry.ts (two specs, FBX/OBJ kinds), image.ts (the file-kind reader), types.ts, service.ts, api.ts
web/src/app/graphs/[id]/   settings panels and cards for the two steps
```

## Changes to earlier specs

- v1 spec: Prepare Asset is named Prepare Model; "normalizes scale and pivot" becomes "fixes the axes" (the template fits the size);
  the input limit becomes 32 MiB on the worker but uploads stop at 4 MB; Blender's "no network" is optional hardening on Cloud Run; shapes
  from a fixed list are added (the v1 spec allowed "low-poly shapes the Blender step can make").
- Slice 4 spec: the queue it expected for Blender is not needed (inline and cached); Describe Game's timeout is capped by Play's
  deadline.
- Graph engine spec: the runner stays sequential; the cache the spec deferred now exists for Blender jobs (as it does for Describe Game).
