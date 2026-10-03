# Graph engine (slice 3a): design

Date: 2026-10-03. Status: approved by the studio (2026-10-03); the loop-check note was added when the plan was written.
Path: architectural (new subsystem). Parent:
`2026-10-02-studio-platform-v1-design.md`, which this slice amends (see "Changes to the v1 spec"). Builds on
`2026-10-02-web-foundation-design.md` (sign-in, the run store, the settings and GLB validators, the Preview page).

## Purpose

A signed-in `@punx.ai` person has a saved **graph**: a few typed nodes wired together (a reference picture, a palette
taken from it, optionally their own 3D models, a game template with tuning, a preview). They press Play. The server
checks the graph, runs it, and stores the result as an ordinary run, which the existing Preview page plays. Every
failure is reported on the node it belongs to, in plain words.

This slice is the engine under the node canvas: the graph format, typed wires, the node executors, the runner, saved
graphs, uploaded files and the API. The canvas itself is slice **3b** (its own spec and plan, written next). Slice 3a
is checked in a browser through a deliberately plain page that is thrown away when 3b arrives.

**Done for this slice** (each is a check in "Testing and acceptance"):

1. Signed out, every graph page and graph API call is refused.
2. A person creates the starter graph, uploads a picture, presses Play, and plays a game whose colors come from
   that picture, on a desktop and on a phone.
3. The same with their own GLB wired to the hero.
4. Bad input is refused in plain words that name the node: a missing input, a wrong wire type, a file that is not an
   image, an oversized image, unplayable tuning.
5. One person cannot read, run or delete another person's graph or its files.
6. Pressing Play twice leaves one run for the graph.
7. No secret is in the repository.

## Decisions made with the studio

| Decision | Choice | Why |
|---|---|---|
| Slice 3 split | 3a engine (this spec), then 3b canvas | The engine is where the correctness risk is; the canvas is built on a stable graph and API contract. |
| Running a graph | One request runs the whole graph and returns every node's state, result and error | Nothing in this slice takes more than about a second. The runner still emits events through a callback, so streaming or polling can be added when a slow node (AI, Blender) arrives, without touching the engine. |
| Caching | Deferred until the first slow node exists (slice 4 or 5) | A cache with only millisecond nodes cannot be seen working. Every file already has a SHA-256, so cache keys can be added later. |

Choices made in the design, to change if wrong (the studio approved the design as a whole): nodes run one at a time (the
v1 spec only said branches *may* run in parallel); each graph keeps one run (the latest); at most 10 graphs per person
and 20 uploaded files per graph; `sharp` is added as a direct dependency (Next.js already carries it as an optional
one).

## Out of scope for this slice

The canvas and any editing UI beyond the plain page (3b), caching, parallel branches, streaming (SSE) or job-style
runs, the Prompt node and the `text` wire type (slice 4), Blender and FBX/OBJ/`.blend` uploads (slice 5), sharing
graphs, open sign-up and quotas, undo or version history of a graph.

## Architecture

```
Plain page / (later) canvas ---HTTP---> /api/graphs...            requireUser() on every route
                                           |
                                    Graph service  ---------> Graph store: Firestore (graphs) + Cloud Storage (files)
                                           |
                                      Runner: validate -> order -> execute -> events
                                           |
                    node executors: reference-image, model, palette-from-image, game-template, preview
                                                  |                                       |
                                          image decoding (sharp)                  Run service (slice 2):
                                                                                  createRun + putFile -> /runs/{id}/preview
```

### Units

| Unit | Does | Interface | Depends on |
|---|---|---|---|
| Graph schema | Parses a graph document strictly and checks its structure | `parseGraph(unknown) -> {ok, graph} \| {ok:false, error}` | none (pure) |
| Node registry | The closed list of node types: label, one-line help, typed ports, params, executor | `NODE_TYPES` | none |
| Run checks | Finds every problem that stops a run, per node, before anything executes | `checkGraph(graph, assets) -> Problem[]` | registry (pure) |
| Runner | Orders nodes, executes them, skips dependents of failures, emits events | `runGraph(graph, deps, onEvent) -> RunResult` | registry, executors |
| Palette | Turns RGBA samples into five readable colors | `makePalette(samples) -> string[5]` | none (pure) |
| Image reader | Decodes an uploaded PNG or JPEG safely | `readImage(bytes) -> {width, height} \| error`, `sampleImage(bytes) -> samples` | `sharp` |
| Graph store (two ports) | Graph records and graph files | `GraphRecords`, `GraphFiles`, with in-memory fakes and Firebase adapters | Firestore, Cloud Storage |
| Graph service | Rules about who may do what with a graph, its files and its run | `createGraph`, `getGraph`, `saveGraph`, `deleteGraph`, `listGraphs`, `addAsset`, `readAsset`, `play` | store ports, runner, Run service |
| Routes and plain page | HTTP over the service; one small functional page | See "API" | `requireUser()`, service |

The schema, run checks, runner, palette and every executor except Preview are pure or sit behind ports, so they are
tested without Firebase or a network.

## Graph model

One JSON document per graph, stored inside its Firestore record:

```json
{
  "schemaVersion": 1,
  "nodes": [
    { "id": "n1", "type": "reference-image", "params": { "asset": null }, "position": { "x": 0, "y": 0 } },
    { "id": "n2", "type": "palette-from-image", "params": {}, "position": { "x": 240, "y": 0 } }
  ],
  "edges": [
    { "from": { "node": "n1", "port": "image" }, "to": { "node": "n2", "port": "image" } }
  ]
}
```

- `id` matches `^[A-Za-z0-9_-]{1,32}$` and is unique. `position` belongs to the editor; the engine never reads it.
  Unknown keys anywhere are refused, and the parser never indexes an object by a key it was given (`__proto__`,
  `constructor`).
- A wire carries one of four types: `image`, `model`, `palette`, `settings` (`text` arrives in slice 4). An output may
  feed any number of inputs; an input takes at most one wire.
- At most 50 nodes, 200 edges, and 64 KB of JSON.

### Node types

| Type | Plain name and help | Params | Inputs | Output |
|---|---|---|---|---|
| `reference-image` | **Reference Image**: the picture the game's colors come from | `asset`: a file hash or `null` | none | `image` |
| `model` | **3D Model**: a model of your own (a GLB file) | `asset`: a file hash or `null` | none | `model` |
| `palette-from-image` | **Palette from Image**: picks five colors from a picture | none | `image` (required) | `palette` |
| `game-template` | **Game Template**: a one-tap runner; sets how fast and how high it plays | `tuning`: `speed`, `jumpHeight`, `obstacleSpacing` | `palette`, `hero`, `obstacle`, `collectible` (the last three are `model`); all optional | `settings` |
| `preview` | **Preview**: plays the game | none | `settings` (required) | none (its result is a run id) |

The registry also holds each port's plain name and a one-line help text, so the canvas can show them without a
second source of wording.

- **Defaults.** A missing `palette` falls back to the sample palette (`#1b1f3b #ff6f59 #ffd166 #06d6a0 #ffffff`). A
  missing model falls back to the built-in sample shape for that role. The three built-in GLBs (1.5 KB each) are
  embedded in code as base64, and a test checks that they are byte-identical to the Unity samples and pass `checkGlb`.
  A **connected input whose source failed is an error, not an absent input**: the default never hides a failure.
- **Tuning** defaults to speed 6, jump height 2.2, spacing 12 in the starter graph.
- **Starter graph:** Reference Image → Palette from Image → Game Template → Preview, plus one unconnected 3D Model node
  (state "not used"), so a person can see where their own model would go. 3b may change the starter.

## Checks

Two layers, so that a half-built graph can always be saved and Play always says everything that is wrong.

**On save** (`PUT`): the graph must parse (schema, ids, known node types, known ports, no unknown keys), a wire must
join an output to an input of the same type, an input may have only one wire, the limits hold, and an `asset` must be
a hash of a file already uploaded to this graph with the right kind (image or model). Anything else is accepted, even
a graph with no Preview.

**On Play** (`checkGraph`, before any node executes), for the nodes that lead to the Preview, collecting all problems:

| Problem | Message (the node is named in the problem) |
|---|---|
| No Preview, or more than one | "Add a Preview node to see your game." / "A graph can have only one Preview." |
| A loop | "These steps loop back on themselves: Palette from Image, Game Template." |
| A required input not connected | "Palette from Image needs a picture. Connect a Reference Image." |
| A required file not chosen | "Reference Image: choose a picture." |

With today's five node types a loop cannot be drawn: the wire-type rule on save already forbids it (no node's output
type can reach an input upstream of itself). The loop check is kept as a guard for node types added later, and is tested
with a made-up pair of types.

A graph with problems is not run: the response is 422 with the list. Nodes that do not lead to the Preview are not
checked and not run; they report "not used".

## Runner

`runGraph(graph, deps, onEvent)` runs only nodes that lead to the Preview, in dependency order, ties broken by node id
so that the order is the same every time, one node at a time.

- **States:** `waiting`, `running`, `done`, `skipped`, `failed`, `not-used`.
- **Events**, in order: `node-started {node}`, `node-done {node, result}`, `node-failed {node, error}`,
  `node-skipped {node, because}`, `run-done {state}`. The API returns the ordered list.
- **Failure:** an executor either returns a value or throws a `NodeError` whose message is a plain sentence. The node
  is `failed`; every node downstream is `skipped` with "Skipped because <node> failed"; independent branches finish.
  Any other thrown value becomes "Something went wrong on our side" and is logged with the graph id, node id and node
  type, never file contents.
- **Executors** are `execute(inputs, params, context) -> output`. The context offers `readAsset(hash)`, the built-in
  models, and (for Preview only) the run service and the signed-in user. Wire values carry references (hash, name,
  size), not bytes, except where a node must read them.
- **Result** per node, small enough to show on a node: `image` `{name, width, height}`; `model` `{name, size}`;
  `palette` the five colors; `settings` the tuning; `preview` `{runId}`. The canvas draws thumbnails from the file
  route; the engine never sends bytes.
- The run is `done` when the Preview ran, `failed` when it did not.
- The route sets a 60-second maximum duration. A run is expected to take about a second.

## The nodes

- **Reference Image.** Reads the chosen file's record. Fails with "the file is missing, choose it again" if the record
  is gone. (The file was already checked when uploaded.)
- **3D Model.** Same, for a GLB.
- **Palette from Image.** See "Palette from Image".
- **Game Template.** Takes the palette (or the default), builds a settings document `{schemaVersion: 1, template:
  "runner", palette, roles: {hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb"}, tuning}`,
  and runs it through `validateSettings`, so an unplayable tuning gives the same message as the Unity template,
  prefixed with the node name. Its output holds the settings text and, per role, the model to store (the connected
  one, or the built-in). Nothing is stored yet.
- **Preview.** The only node with a side effect. It deletes the graph's previous run (so that pressing Play never
  runs into the 20-run cap), creates a run from the settings text through the run service, stores the three GLBs
  with `putFile`, records the run id on the graph, and returns it. If creating the run fails, the node fails and the
  graph is left without a run. The page then links to `/runs/{id}/preview`, which slice 2 already serves.

## Palette from Image

Server side, deterministic, so the same picture always gives the same colors.

1. `sharp` decodes the file with an input limit of 25 million pixels and `failOn: "error"`, applies the EXIF
   rotation, shrinks it to fit 64 × 64 and returns raw RGBA. Pixels with alpha below 128 are ignored; a fully
   transparent picture fails with "the picture is completely transparent".
2. **Median cut** into five boxes (split the box with the widest channel range at its median, ties by lowest index;
   no randomness). Each box's color is the mean of its pixels. A picture with fewer than five distinct colors is
   filled out with lightness variations of what it has; it never fails for lack of colors.
3. **Slots.** The template uses slot 0 as the background and the HUD text, slot 1 as the ground, slot 2 as the HUD
   panel, slot 4 as the score text, and does not use slot 3 (from `RunnerBootstrap.cs`). So: sort by lightness; slot 0
   is the darkest; slot 4 the lightest; slot 1 the most saturated of the other three; of the remaining two, slot 2
   (the HUD panel) is the lighter and slot 3 the darker.
4. **Readability guard**, by WCAG relative-luminance contrast, nudging lightness only as far as needed: slot 4 on
   slot 0 at least 4.5:1 (darken slot 0, then lighten slot 4, which always reaches 21:1 at the limit), slot 0 on
   slot 2 at least 3:1 (lighten slot 2), slot 1 against slot 0 at least 1.5:1. Without this, a bright picture would
   give white score text on a white background.

The exact thresholds live in one constants block and are tested.

## Storage and API

### Records and files

Firestore `graphs/{id}` (a random 128-bit URL-safe id, as for runs):

```
{ ownerUid, ownerEmail, name, createdAt, updatedAt, graph,
  assets: { "<sha256>": { name, size, kind: "image" | "model", width?, height?, uploadedAt } },
  lastRunId?: string }
```

Cloud Storage: `graphs/{graphId}/assets/{sha256}`. The rules stay deny-all (the existing `firestore.rules` and
`storage.rules` already cover every path). Only the server touches them.

Limits: 10 graphs per person ("You have 10 graphs. Delete one first."), a 4 MB file (the slice 2 cap, under Vercel's
4.5 MB), 20 files per graph. A file nothing refers to for more than five minutes is deleted when the graph is next
saved or when an upload would exceed 20.

### Routes

Every route calls `requireUser()`; `POST`, `PUT` and `DELETE` also check `Origin`. A graph that is missing, owned by
someone else, or a file not in its `assets` all give the same 404, as for runs. Ids are checked against the same
pattern as run ids before any lookup.

| Route | Does |
|---|---|
| `GET /api/graphs` | The caller's graphs (id, name, updatedAt, lastRunId). |
| `POST /api/graphs` | Creates a graph, from the starter or empty. |
| `GET /api/graphs/{id}` | The record (graph and assets). |
| `PUT /api/graphs/{id}` | Replaces name and graph after the "on save" checks. The last write wins. |
| `DELETE /api/graphs/{id}` | Deletes the graph, its files and its run. |
| `POST /api/graphs/{id}/assets?name=` | Raw body, at most 4 MB. Sniffs PNG, JPEG or GLB by its first bytes (never the name or the declared type), checks it (below), stores it by hash, returns `{sha256, name, size, kind}`. The same bytes twice give the same answer. |
| `GET /api/graphs/{id}/assets/{sha256}` | The file, with the sniffed type, `X-Content-Type-Options: nosniff`, `Cache-Control: private`. |
| `POST /api/graphs/{id}/play` | Reads the **saved** graph (never a request body, so what runs is what is saved), runs the "on Play" checks, then the runner. 422 with the problems, or 200 with `{state, order, nodes: {id: {state, result?, error?}}, runId?}`. |

Uploads are checked at upload time: an image must decode within the pixel limit; a GLB must pass `checkGlb`. Names are
shown to people but never used in a path.

### The plain page

`/graphs` lists graphs and has "New from starter". `/graphs/{id}` shows the nodes as a list, with a file picker on
Reference Image and 3D Model, number fields for the tuning, a text box with the graph JSON for hand editing (this is
how a wire to the hero is added, and how a bad graph is tried), Save, Play, the per-node results in run order with
their plain-word errors, and a Preview link. It is replaced by the canvas in 3b.

## Security

- Every uploaded byte, name, graph and parameter is untrusted. Node types come from a closed registry, so nothing in
  a graph can run code or name a file path. Storage paths are built from ids and hashes the server computed.
- Image decoding is the new attack surface: PNG and JPEG only (no SVG; an animated PNG is read as its first frame), a
  4 MB file cap and a 25-megapixel cap before decoding, `failOn: "error"`, libvips limited to one thread
  (`sharp.concurrency(1)`) and its cache off. A file whose bytes are not an image, whatever its name, is refused at
  upload.
- Graph JSON is parsed strictly (above) and bounded in size before parsing.
- Logs carry the graph id, node id, node type and a failure kind, never file contents.
- Ownership, origin checks and uniform 404s are the slice 2 patterns, with the same tests.
- The Unity player is unchanged; the slice 1 follow-ups about hardening its loader remain a gate before any use beyond
  punx.ai.

## Error handling

Every failure names the node and the cause in plain words and says what to do: "Reference Image: choose a picture.",
"Reference Image: the picture is larger than 4 MB. Choose a smaller file.", "Palette from Image: this picture is
more than 25 million pixels. Choose a smaller one.", "Game Template: <the slice 2 winnability message>", "Preview:
could not save the game, try Play again." Problems that are not the person's fault say "Something went wrong on our
side" and are logged as above.

## Testing and acceptance

- **Test-first, pure code.** Graph schema (valid, and one row per refusal, including `__proto__` keys and oversize);
  run checks (one row per problem, several at once); runner with fake executors (stable order, failure skipping,
  independent branches finishing, not-used nodes, optional inputs versus a failed source, event sequence);
  palette (generated pictures: flat, two-color, white, black, transparent, noisy, and the slot and contrast table,
  including a bright picture); the built-in models match the Unity samples.
- **Image reader,** with pictures made in the test by `sharp`: PNG, JPEG, EXIF-rotated, oversize in pixels,
  corrupt, and non-image bytes named `.png`.
- **Test-first, with fakes.** The graph service and routes against in-memory records and files: signed out, wrong
  origin, someone else's graph, caps, oversize body, wrong kind of file for a node, unreferenced-file cleanup, Play
  replacing the previous run, a failed Play leaving no run. The Firebase adapters are written test-first against
  the same port tests; real Firebase is exercised in the deployed checks.
- **Deployed checks, in a real browser** (after slice 2's deployment is up): each of the seven done-criteria above;
  the starter graph with a real picture; a bad file of each kind; a second account cannot reach the first one's
  graph, file or run; `sharp` loads in the Vercel function.
- **Phone.** The Preview opens on a phone from a graph's Play. This also closes the phone check still open from
  slice 1.

## Risks, tested first in the plan

1. **`sharp` on Vercel and on this machine:** native binaries. A first task decodes a picture in a function on the
   deployment (and in a test locally) before anything is built on it. Fallback: pure-JavaScript decoders (`pngjs`,
   `jpeg-js`), slower but dependency-free.
2. **Palette quality** is partly a matter of taste: the guard makes the game readable, not pretty. Checked by eye
   on a few real pictures with the studio.
3. **One run per graph under two simultaneous Plays** can leave an extra run behind (last write wins on
   `lastRunId`); it shows in the runs list and can be deleted. Accepted for a one-person-per-graph tool.
4. **Last write wins on a graph** if it is open in two tabs. Accepted; revisited in 3b if it bites.
5. **Slice 2 deployment is not live yet.** The engine is built and tested locally with fakes regardless; the
   deployed checks wait for it.

## Repository layout

```
web/src/lib/graph/        schema.ts, registry.ts, checks.ts, runner.ts, palette.ts, image.ts, starter.ts,
                          builtin.ts (base64 models), nodes/*.ts, store/{ports,memory,firebase}.ts, service.ts
web/src/app/api/graphs/   the routes
web/src/app/graphs/       the plain page
web/package.json          adds sharp as a direct dependency
```

## Changes to the v1 spec

`2026-10-02-studio-platform-v1-design.md` is updated alongside this one: slice 3 is split into 3a (this engine) and
3b (the canvas); caching moves to the first slice with a slow node; the Asset Upload node is named 3D Model and the
Game Template node takes palette and per-role models directly (no draft `settings` until slice 4); the graph is
checked on save and on Play; nodes run one at a time.
