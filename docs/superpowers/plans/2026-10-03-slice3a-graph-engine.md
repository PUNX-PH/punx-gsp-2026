# Slice 3a: Graph Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in `@punx.ai` person has a saved graph of typed nodes, presses Play, and the server checks and runs it, storing the result as an ordinary run that the existing Preview page plays.

**Architecture:** A pure, typed-graph engine (schema, run checks, runner, node executors) behind ports with in-memory fakes, exactly like slice 2's run service. A graph service holds the rules (ownership, caps, uploads, Play); thin route handlers and a deliberately plain page sit on top. Palette from Image decodes with `sharp` on the server. Preview is the only node with a side effect: it stores the game through the slice 2 run service.

**Tech Stack:** TypeScript, Next.js 16.3.8 (App Router, Vercel), Vitest, Firebase Admin (Firestore, Cloud Storage), `sharp` 0.35.

**Spec:** `docs/superpowers/specs/2026-10-03-graph-engine-design.md` (read it first). Slice 2 code it builds on: `web/src/lib/runs/`, `web/src/lib/api/handlers.ts`, `web/src/lib/glb.ts`, `web/src/lib/settings.ts`.

## Global Constraints

- Work in `web/`, on branch `slice-3a-graph-engine` (cut from `slice-2-web-foundation`). Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`. Tests: `npx vitest run <path>`; the gate is `npm test`, `npm run lint`, `npm run build`, stopping at the first failure. Baseline before Task 1: 199 tests passing.
- `web/AGENTS.md`: this Next.js has breaking changes. Read the relevant guide in `web/node_modules/next/dist/docs/` before writing any route or page.
- Test first, and mutation-check every security rule (origin check, ownership, size caps, magic-byte sniffing, pixel cap): after its test passes, break the rule once, see the test fail, restore it.
- Every commit message ends with the line `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push (ask first); the repo is public, so no secrets or personal paths in anything committed.
- Limits, verbatim from the spec: graph JSON 64 KB, 50 nodes, 200 edges; 4 MB per uploaded file; 25 million pixels per picture; 10 graphs per person ("You have 10 graphs. Delete one first."); 20 files per graph ("This graph has 20 files. Remove one first."); an unreferenced file is removable after 5 minutes; graph name 1 to 80 characters (default "Untitled game"); shown file names at most 100 characters, no control characters; play route `maxDuration = 60`.
- Palette: slots 0 background and HUD text, 1 ground, 2 HUD panel, 3 unused, 4 score text. Contrast (WCAG relative luminance): slot 4 on slot 0 at least 4.5, slot 0 on slot 2 at least 3, slot 1 against slot 0 at least 1.5. Sample palette `#1b1f3b #ff6f59 #ffd166 #06d6a0 #ffffff`. Default tuning speed 6, jumpHeight 2.2, obstacleSpacing 12. Role files always `hero.glb`, `obstacle.glb`, `collectible.glb`.
- Ids (graph ids and node ids) follow `^[A-Za-z0-9_-]{1,32}$`; graph record ids use the run id pattern and a random 128-bit id. Node ids `__proto__`, `constructor` and `prototype` are refused.
- A failure that is not the person's fault says "Something went wrong on our side" and is logged with ids and `describeFailure(error)` only, never file contents or error messages. No new environment variables.
- Pure logic lives behind ports with in-memory fakes (`store/memory.ts`); the Firebase adapters stay thin and are first exercised on the deployment (Task 14).

## Review Focus

Inputs a person will meet that the spec does not spell out. Each has a test in the task named.

1. A PNG logo on a transparent background: its colors come out, not black (Task 1).
2. A 1 × 1 or 2 × 2 picture: a valid five-color palette still comes out (Task 2).
3. A tuning that is a string, `null`, or `Infinity` (JSON `1e999`) in the graph file (Task 3).
4. The graph's previous run was already deleted from the home page: Play still works (Task 8).
5. A hostile file name in `?name=` (control characters, `<script>`, path separators, 300 characters), and the same bytes uploaded under two names (Task 10).

---

## File Structure

```
web/src/lib/graph/
  types.ts        every shared type and error (Task 3)
  registry.ts     NODE_SPECS: labels, help, ports, params checks (Task 3)
  schema.ts       parseGraph (Task 3)
  walk.ts         ancestors, orderNodes (Task 4)       checks.ts   checkGraph (Task 4)
  runner.ts       runGraph (Task 5)
  image.ts        sniffKind, readImage, sampleImage (Task 1)   palette.ts  makePalette (Task 2)
  builtin.ts      the three built-in GLBs as base64 (Task 6)
  nodes/          gameTemplate.ts (6), referenceImage.ts, model.ts, paletteFromImage.ts (7), preview.ts (8), index.ts (EXECUTORS)
  store/          ports.ts, memory.ts, firebase.ts (Task 9)
  starter.ts, service.ts (10, 11)   api.ts (12)   firebase.ts getGraphService (12)   edits.ts (13)
web/src/lib/testing/images.ts      test helpers: makePng, makeJpeg (Task 1)
web/src/lib/api/guard.ts           the shared request guard, extracted from handlers.ts (Task 12)
web/src/app/api/graphs/...         routes (12)      web/src/app/graphs/...   the plain page (13)
```

---

### Task 1: Image reader (and `sharp`)

**Files:** Create `web/src/lib/graph/image.ts`, `image.test.ts`, `web/src/lib/testing/images.ts`. Modify `web/package.json` and `package-lock.json`.

**Interfaces:**
- Produces:
  - `MAX_IMAGE_PIXELS = 25_000_000`; `type FileKind = "png" | "jpeg" | "glb"`; `sniffKind(bytes: Uint8Array): FileKind | null` (first bytes only: PNG `89 50 4E 47 0D 0A 1A 0A`, JPEG `FF D8 FF`, GLB `glTF`).
  - `readImage(bytes): Promise<{ ok: true; width: number; height: number } | { ok: false; error: string }>`.
  - `sampleImage(bytes): Promise<{ ok: true; pixels: Uint8Array } | { ok: false; error: string }>`: `pixels` is packed RGB triples of the pixels with alpha 128 or more, from the picture shrunk to fit 64 × 64 (never enlarged).
  - Test helpers `makePng(width, height, rgb: [number, number, number], alpha?: number): Promise<Uint8Array>`, `makeJpeg(...)` (same shape), `makePngFromPixels(width, height, rgba: Uint8Array)`.
  - `error` strings are plain sentences with no node prefix: "this is not a PNG or JPEG picture", "this picture is more than 25 million pixels. Choose a smaller one.", "this picture could not be read. Choose another file.", "the picture is completely transparent".

- [ ] **Step 1: Add the dependency.** `cd web && npm install sharp@0.35.5` (the version Next already carries; the spec approves it as a direct dependency). Expected: `sharp` appears under `dependencies`; `package-lock.json` still lists `@img/sharp-linux-x64`.
- [ ] **Step 2: Write the failing tests** in `image.test.ts`, with pictures from the helpers:
  - `sniffKind` table: PNG, JPEG, GLB magic give their kind; `<svg `, `GIF89a`, empty bytes and plain text give `null`.
  - `readImage`: a 10 × 20 PNG gives `{ok: true, width: 10, height: 20}`; likewise a JPEG, a grayscale PNG and a 1 × 1 PNG; a 6000 × 5000 solid PNG gives an error containing "25 million pixels" (check width × height from the metadata before decoding, and also pass `limitInputPixels`); PNG magic followed by random bytes gives "could not be read"; plain text gives "not a PNG or JPEG".
  - `sampleImage`: a solid red 100 × 100 PNG gives `pixels.length === 64 * 64 * 3` and every triple `[255, 0, 0]`; a solid 10 × 10 PNG is not enlarged (`length === 300`).
  - **Review Focus 1:** a 10 × 10 RGBA PNG whose left half is `(0, 0, 0, 0)` and right half `(0, 255, 0, 255)` gives exactly 50 triples, all `[0, 255, 0]`.
  - A fully transparent picture gives `{ok: false, error: "the picture is completely transparent"}`.
- [ ] **Step 3: Run to verify they fail.** `npx vitest run src/lib/graph/image.test.ts` fails (module missing).
- [ ] **Step 4: Implement `image.ts` and `testing/images.ts`.** At module scope `sharp.cache(false)` and `sharp.concurrency(1)`. Open every decode with `{ limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" }`; `sampleImage` applies `.rotate()`, `.resize(64, 64, { fit: "inside", withoutEnlargement: true })`, `.ensureAlpha().raw()`, then drops pixels with alpha below 128. Map every sharp exception to the "could not be read" sentence.
- [ ] **Step 5: Run to verify they pass,** then `npm test` (all 199 still pass).
- [ ] **Step 6: Commit** `feat: image reader with sharp (magic-byte sniffing, pixel cap, transparent-safe sampling)`.

---

### Task 2: Palette

**Files:** Create `web/src/lib/graph/palette.ts`, `palette.test.ts`.

**Interfaces:**
- Produces: `SAMPLE_PALETTE: readonly string[]`; `PALETTE_RULES = { scoreOnBackground: 4.5, hudTextOnPanel: 3, groundOnBackground: 1.5 } as const`; `contrastRatio(a: string, b: string): number` (WCAG, 1 to 21, from `#rrggbb`); `makePalette(pixels: Uint8Array): string[]` (RGB triples, at least one pixel; five lowercase `#rrggbb`).

- [ ] **Step 1: Write the failing tests.**
  - `contrastRatio("#000000", "#ffffff")` is 21 and `contrastRatio("#777777", "#777777")` is 1.
  - Deterministic: the same pixels twice give equal arrays; every entry matches `/^#[0-9a-f]{6}$/`; the input array is not modified.
  - Slot rules, exact: ten pixels each of `#101030 #f0f0f0 #ff0000 #808080 #c0c0c0` (shuffled) give `["#101030", "#ff0000", "#c0c0c0", "#808080", "#f0f0f0"]` (darkest first, lightest last, most saturated of the rest as ground, lighter of the remaining two as the panel).
  - Readability table (`it.each`): five light pastels, five dark colors, flat white, flat black, flat mid-grey `#808080`, and 2000 pixels from a seeded linear-congruential generator each give a palette where `contrastRatio(p[4], p[0]) >= 4.5`, `contrastRatio(p[0], p[2]) >= 3` and `contrastRatio(p[1], p[0]) >= 1.5`.
  - A flat `#3366cc` and a two-color picture give five valid colors and pass the same three ratios (filled out with lightness variations, never an error).
  - **Review Focus 2:** a single pixel, and four pixels, give five valid colors passing the ratios.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/lib/graph/palette.test.ts`.
- [ ] **Step 3: Implement `makePalette`.** Median cut: put all pixels in one box; repeatedly split the box with the widest single-channel range, sorting its pixels by that channel and cutting at the value boundary nearest the median (never inside a run of equal values; a box of one color is never split); stop at five boxes or when nothing can split. A box's color is the mean of its pixels. With fewer than five boxes, add lightness variations (HSL lightness steps of the existing colors) until five. Then assign slots: sort by relative luminance; slot 0 darkest, slot 4 lightest, slot 1 the highest HSL saturation of the middle three (ties: lower luminance), slot 2 the lighter and slot 3 the darker of the other two. Then the guard, in this order, each moving HSL lightness in 1% steps only as far as needed: darken slot 0 (to black) then lighten slot 4 (to white) for 4.5; lighten slot 2 for 3 against slot 0; lighten slot 1 for 1.5 against slot 0. All constants come from `PALETTE_RULES`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat: palette from pixels (median cut, template slots, readability guard)`.

---

### Task 3: Types, registry and graph schema

**Files:** Create `web/src/lib/graph/types.ts`, `registry.ts`, `schema.ts`, `schema.test.ts`.

**Interfaces:**
- Produces in `types.ts` (every later task imports from here):
  - `WireType = "image" | "model" | "palette" | "settings"`; `Role = "hero" | "obstacle" | "collectible"`; `ROLE_FILES: Record<Role, string>` (`hero.glb`, `obstacle.glb`, `collectible.glb`).
  - `Graph = { schemaVersion: 1; nodes: GraphNode[]; edges: GraphEdge[] }`; `GraphNode = { id: string; type: string; params: Record<string, unknown>; position: { x: number; y: number } }`; `GraphEdge = { from: PortRef; to: PortRef }`; `PortRef = { node: string; port: string }`; `Tuning = { speed: number; jumpHeight: number; obstacleSpacing: number }`.
  - `AssetInfo = { name: string; size: number; kind: "image" | "model"; contentType: string; width?: number; height?: number; uploadedAt: number }`; `Assets = Record<string, AssetInfo>` (keys: SHA-256 hex).
  - `GraphRecord = { id; ownerUid; ownerEmail; name; createdAt; updatedAt: number; graph: Graph; assets: Assets; lastRunId: string | null }`.
  - `class GraphError extends Error { status: 400 | 404 | 409 }`; `class NodeError extends Error` (a plain-sentence node failure).
  - `ModelSource = { kind: "asset"; sha256: string } | { kind: "builtin"; role: Role }`; `WireValue = { type: "image"; sha256: string; name: string; width: number; height: number } | { type: "model"; sha256: string; name: string; size: number } | { type: "palette"; colors: string[] } | { type: "settings"; settingsText: string; tuning: Tuning; models: Record<Role, ModelSource> }`.
  - `ExecutorContext = { user: User; assets: Assets; readAsset(sha256: string): Promise<Uint8Array | null>; runs: Pick<RunService, "createRun" | "putFile" | "deleteRun">; lastRun: { get(): string | null; set(id: string | null): void } }`; `Executor = (inputs: Partial<Record<string, WireValue>>, params: Record<string, unknown>, ctx: ExecutorContext) => Promise<{ output?: WireValue; result: unknown }>`.
  - `Problem = { node: string | null; message: string }`. (The runner's own types, `NodeState`, `RunEvent`, `NodeOutcome` and `RunResult`, are defined in `runner.ts`, Task 5.)
- Produces in `registry.ts`: `PortSpec = { name: string; label: string; help: string; type: WireType; required: boolean; missing?: string }` (`missing` is the full sentence for a required input that is not connected); `NodeSpec = { type: string; label: string; help: string; final: boolean; inputs: PortSpec[]; outputs: PortSpec[]; defaultParams(): Record<string, unknown>; shapeProblem(params: Record<string, unknown>): string | null; incompleteProblem(params: Record<string, unknown>): string | null }`; `NODE_SPECS: Record<string, NodeSpec>` for `reference-image`, `model`, `palette-from-image`, `game-template`, `preview` with the plain names, helps and ports in the spec (ports: reference-image out `image`; model out `model`; palette-from-image in `image` (required, `missing`: "Palette from Image needs a picture. Connect a Reference Image."), out `palette`; game-template in `palette`, `hero`, `obstacle`, `collectible`, all optional, out `settings`; preview in `settings` (required, `missing`: "Preview needs a game. Connect a Game Template."), `final: true`). `shapeProblem` is the structure check at save (asset is a 64-hex string or `null`; tuning is exactly three finite numbers; no other keys); `incompleteProblem` is the Play check ("choose a picture." / "choose a model." when `asset` is `null`).
- Produces in `schema.ts`: `MAX_NODES = 50`, `MAX_EDGES = 200`, `parseGraph(input: unknown, specs?: Record<string, NodeSpec>): { ok: true; graph: Graph } | { ok: false; error: string }`.

- [ ] **Step 1: Write the failing tests** in `schema.test.ts`.
  - A valid graph (the four-node starter shape, inline) parses to an equal graph. `NODE_SPECS` has the five types; every port has a non-empty `label` and `help`; every required input has `missing`; `defaultParams()` passes `shapeProblem` (returns `null`).
  - Refusals (`it.each`, each asserting `ok: false` and a plain `error` that names what is wrong): not an object; `schemaVersion: 2`; nodes not an array; 51 nodes; 201 edges; ids `""`, `"a b"`, 33 characters, `"__proto__"`, `"constructor"`; duplicate ids; unknown node type; an unknown key at the top level, on a node and on an edge; `position` missing, a string, or `Infinity`; params wrong per type (reference-image `asset: 5`, `asset: "xyz"`, palette-from-image `{ x: 1 }`); an edge to an unknown node, to an unknown port, from an input port, to an output port; a wire of the wrong type (palette into an `image` input, message names both in plain words); two wires into one input; the same edge twice.
  - **Review Focus 3:** game-template `tuning.speed` as `"6"`, as `null`, as `Infinity` (what JSON `1e999` parses to), as `NaN`; a missing `jumpHeight`; an extra tuning key.
  - An output feeding two inputs is accepted.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/lib/graph/schema.test.ts`.
- [ ] **Step 3: Implement `types.ts`, `registry.ts`, `schema.ts`.** The parser reads known keys only (never indexes by a given key), checks in this order (shape, ids, nodes, edges, wiring) and returns the first error. Remember that `NODE_SPECS` keys are plain constants, so look types up with `Object.hasOwn`.
- [ ] **Step 4: Run to verify they pass;** mutation-check the "two wires into one input" and the wire-type rules.
- [ ] **Step 5: Commit** `feat: graph types, node registry and strict graph parser`.

---

### Task 4: Graph walking and run checks

**Files:** Create `web/src/lib/graph/walk.ts`, `checks.ts`, `checks.test.ts`.

**Interfaces:**
- Consumes: `Graph`, `Assets`, `Problem`, `NodeSpec`, `NODE_SPECS`.
- Produces: `ancestors(graph, roots: string[]): Set<string>` (the roots and everything upstream); `orderNodes(graph, among: Set<string>): { ok: true; order: string[] } | { ok: false; cycle: string[] }` (Kahn's algorithm, ties broken by ascending id); `checkGraph(graph: Graph, assets: Assets, specs?: Record<string, NodeSpec>): Problem[]`.

- [ ] **Step 1: Write the failing tests.**
  - `orderNodes`: chain `a→b→c` gives `["a","b","c"]`; two independent branches order by id; every edge goes forward in the result; a cycle gives `{ ok: false, cycle }` naming its nodes.
  - `checkGraph`, one row each, exact messages from the spec: no Preview gives `{node: null, message: "Add a Preview node to see your game."}`; two Previews gives "A graph can have only one Preview."; Palette from Image with no wire gives "Palette from Image needs a picture. Connect a Reference Image." with its node id; Preview with no wire gives "Preview needs a game. Connect a Game Template."; an unset Reference Image gives "Reference Image: choose a picture."; an unset 3D Model wired to a hero input gives "3D Model: choose a model."; a set `asset` that is not in `assets` gives "Reference Image: the file is gone. Choose it again."
  - Nodes that do not lead to the Preview are neither checked nor reported (an unset, unconnected 3D Model gives no problem). Three faults at once give three problems. The starter graph with a picture chosen gives `[]`.
  - A loop (the spec says it cannot be drawn with today's five types, so it is tested with a made-up spec map of two types that feed each other plus a `final` type): "These steps loop back on themselves: <label>, <label>." with `node` set to one of them.
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** `checkGraph` finds the `final` nodes through `specs`, takes `ancestors`, checks the cycle with `orderNodes`, then each node's unconnected required inputs (`PortSpec.missing`), `incompleteProblem` prefixed with the node label, and asset presence.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat: graph walking and Play checks`.

---

### Task 5: Runner

**Files:** Create `web/src/lib/graph/runner.ts`, `runner.test.ts`.

**Interfaces:**
- Consumes: `Graph`, `NodeSpec`, `Executor`, `ExecutorContext`, `NodeError`, `ancestors`, `orderNodes`, `describeFailure` from `@/lib/auth/errors`.
- Produces: `NodeState = "waiting" | "running" | "done" | "skipped" | "failed" | "not-used"`; `RunEvent` = `{type:"node-started"; node}` | `{type:"node-done"; node; result: unknown}` | `{type:"node-failed"; node; error: string}` | `{type:"node-skipped"; node; because: string}` | `{type:"run-done"; state: "done" | "failed"}`; `NodeOutcome = { state: NodeState; result?: unknown; error?: string; because?: string }`; `RunResult = { state: "done" | "failed"; order: string[]; nodes: Record<string, NodeOutcome>; events: RunEvent[] }`; `runGraph(graph: Graph, deps: { executors: Record<string, Executor>; ctx: ExecutorContext; specs?: Record<string, NodeSpec>; log?: (info: object) => void }, onEvent?: (e: RunEvent) => void): Promise<RunResult>`.

- [ ] **Step 1: Write the failing tests** with a made-up spec map (`src` → `mid` → `sink` final, one output type) and fake executors.
  - Chain `a→b→c` plus an unrelated `z`: events in exactly this order: `node-started a`, `node-done a`, `node-started b`, `node-done b`, `node-started c`, `node-done c`, `run-done done`; `z` is `not-used` and its executor is never called; `order` is `["a","b","c"]`; `onEvent` receives the same events as `result.events`.
  - A producer's `output` reaches the consumer at `inputs[portName]`; an unconnected port is `undefined` in `inputs`; an output feeding two consumers runs the producer once.
  - `b` throws `NodeError("x")`: `b` is `failed` with `error: "x"`, `c` is `skipped` with `because` containing the label of `b`, an independent branch `d→sink` still runs, `run-done` has state `failed`.
  - A source that failed makes its dependent `skipped` even when that input is optional (the default must not hide a failure).
  - An executor that throws `new Error("secret-bytes")`: the outcome's `error` is "Something went wrong on our side", `log` was called once with the node id, type and `describeFailure` text, and `JSON.stringify` of the outcome, the events and the log argument does not contain `secret-bytes`.
  - Two ready nodes order by ascending id. Given a cyclic graph, `runGraph` rejects (callers check first; this is a programming error).
- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement `runGraph`.** Roots are the `final` nodes; run only `ancestors(roots)` in `orderNodes` order, one at a time; collect outputs by node id in a `Map`; build `nodes` and `inputs` without indexing plain objects by node ids (use `Map`, then `Object.fromEntries`). The run is `done` only when every node that ran is `done`.
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Commit** `feat: graph runner with failure skipping and events`.

---

### Task 6: Built-in models and the Game Template node

**Files:** Create `web/src/lib/graph/builtin.ts`, `builtin.test.ts`, `nodes/gameTemplate.ts`, `nodes/gameTemplate.test.ts`.

**Interfaces:**
- Consumes: `Executor`, `NodeError`, `WireValue`, `Role`, `ROLE_FILES`, `SAMPLE_PALETTE`, `validateSettings` from `@/lib/settings`, `checkGlb`.
- Produces: `builtinModel(role: Role): Uint8Array` (a fresh copy on each call); `gameTemplate: Executor`.

- [ ] **Step 1: Generate the embedded models.** For `hero.glb`, `obstacle.glb`, `coin.glb` in `unity/runner-template/Assets/StreamingAssets/sample/`, `base64 -w0` each (1.5 KB) into `builtin.ts` as constants (`collectible` is `coin.glb`).
- [ ] **Step 2: Write the failing tests.**
  - `builtin.test.ts`: each role's bytes equal the Unity sample file (read from the repo path) and pass `checkGlb`; mutating a returned array does not change the next call's result.
  - `gameTemplate.test.ts`: with no inputs and tuning from the params, the output is `{type: "settings"}` whose `settingsText` parses through `validateSettings` to `{schemaVersion: 1, template: "runner", palette: SAMPLE_PALETTE, roles: {hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb"}, tuning}` and whose three `models` are `{kind: "builtin", role}`; a palette input replaces the palette; a `hero` model input gives `models.hero` as `{kind: "asset", sha256}` and leaves the other two built-in; `result` is `{tuning}`; tuning read from `fixtures/settings/invalid-unwinnable-jump.json` rejects with a `NodeError` whose message starts "Game Template: " and contains the slice 2 validator's message; the tuning of `fixtures/settings/valid-range-max.json` is accepted.
- [ ] **Step 3: Run to verify they fail,** implement, run to verify they pass. The executor builds the settings object, serializes it with `JSON.stringify`, and runs it through `validateSettings`.
- [ ] **Step 4: Commit** `feat: built-in models and the Game Template node`.

---

### Task 7: Reference Image, 3D Model and Palette from Image nodes

**Files:** Create `web/src/lib/graph/nodes/referenceImage.ts`, `model.ts`, `paletteFromImage.ts`, `index.ts`, `nodes.test.ts`.

**Interfaces:**
- Consumes: `sampleImage`, `makePalette`, `Executor`, `NodeError`, `ExecutorContext`.
- Produces: `referenceImage`, `model`, `paletteFromImage: Executor`; `EXECUTORS: Record<string, Executor>` in `nodes/index.ts` (Task 8 adds `preview`).

- [ ] **Step 1: Write the failing tests** (contexts built by hand; a PNG from `makePng`).
  - Reference Image with `asset` in `ctx.assets` gives `{type: "image", sha256, name, width, height}` and result `{name, width, height}`; with the asset missing from `ctx.assets` it rejects with `NodeError` "Reference Image: the file is missing. Choose it again." 3D Model likewise gives `{type: "model", sha256, name, size}` and "3D Model: the file is missing. Choose it again."
  - Palette from Image reads the picture through `ctx.readAsset`, gives `{type: "palette", colors}` equal to `makePalette(...)` of the same pixels, and the same bytes twice give identical palettes; `readAsset` returning `null` gives "Palette from Image: the picture is missing. Choose it again."; a fully transparent picture gives "Palette from Image: the picture is completely transparent"; corrupt bytes give a "Palette from Image: ..." sentence.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: Reference Image, 3D Model and Palette from Image nodes`.

---

### Task 8: Preview node

**Files:** Create `web/src/lib/graph/nodes/preview.ts`, `preview.test.ts`. Modify `nodes/index.ts`.

**Interfaces:**
- Consumes: `ExecutorContext.runs`, `ctx.lastRun`, `builtinModel`, `ROLE_FILES`, `RunError` from `@/lib/runs/types`.
- Produces: `preview: Executor` (result `{runId}`, no output); `EXECUTORS` gains `"preview"`.

- [ ] **Step 1: Write the failing tests** against `makeRunService` over `MemoryRunRecords` and `MemoryFileStore`, with a `lastRun` holder.
  - A first Play creates one `ready` run holding `settings.json`, `hero.glb`, `obstacle.glb` and `collectible.glb`, returns `{runId}`, and `lastRun.get()` is that id.
  - A second Play leaves exactly one run for the person (the earlier one is gone) and `lastRun.get()` is the new id.
  - **Review Focus 4:** the previous run is deleted through the run service first (as from the home page), then Play still succeeds.
  - The person has 20 other runs: Preview rejects with a `NodeError` containing "You have 20 runs. Delete one first." and `lastRun.get()` is `null` (the previous run was deleted).
  - A model asset whose bytes `readAsset` cannot return gives "Preview: a model file is missing. Choose it again." and no run was created or deleted (every model is read before any side effect).
  - A `putFile` that throws a plain `Error` leaves no run behind (best-effort delete) and the error propagates (the runner turns it into "Something went wrong on our side").
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass. Order: read all three models' bytes; delete the previous run (ignore a 404 `RunError`); `createRun`; `putFile` three times; `lastRun.set(id)`.
- [ ] **Step 3: Commit** `feat: Preview node stores the game as the graph's one run`.

---

### Task 9: Store ports, in-memory fakes and Firebase adapters

**Files:** Create `web/src/lib/graph/store/ports.ts`, `memory.ts`, `firebase.ts`, `store.test.ts`.

**Interfaces:**
- Consumes: `GraphRecord`, `Graph`, `AssetInfo`, `GraphError`, `getFirestore`, `getStorage`, `adminApp` from `@/lib/auth/firebaseAdmin` (the pattern in `web/src/lib/runs/firebase.ts`).
- Produces:
  - `GraphRecords`: `create(record)`, `get(id): Promise<GraphRecord | null>`, `listByOwner(uid)`, `update(id, change: { name?: string; graph?: Graph; removeAssets?: string[]; updatedAt: number }): Promise<GraphRecord>` (atomic; `GraphError(404)` when missing), `addAsset(id, sha256, info, max): Promise<GraphRecord>` (atomic; an existing hash returns the record unchanged; `GraphError(409, "This graph has 20 files. Remove one first.")` at `max`), `setLastRunId(id, runId: string | null)`, `delete(id)`.
  - `GraphFiles`: `put(graphId, sha256, bytes, contentType)` (idempotent: the same hash twice is fine), `get(graphId, sha256): Promise<Uint8Array | null>`, `delete(graphId, sha256)`, `deleteGraph(graphId)`.
  - `MemoryGraphRecords`, `MemoryGraphFiles` (yield to others like `runs/memory.ts`, store clones); `FirestoreGraphRecords` (collection `graphs`, whole `assets` map replaced inside transactions), `CloudGraphFiles` (objects `graphs/{graphId}/assets/{sha256}`, no precondition because content-addressed).

- [ ] **Step 1: Write the failing contract tests** in `store.test.ts`, run against the memory classes: create, get and list by owner (not others'); `update` replaces name and graph and removes the listed assets; `update` of a missing graph throws 404; `addAsset` adds, the same hash twice leaves one entry and returns the record unchanged, and refuses at `max` with a 409; two concurrent `addAsset` calls at `max - 1` let exactly one in; `setLastRunId` sets and clears; `delete`; files: `put` twice is fine, `get` of a missing file is `null`, `deleteGraph` removes only that graph's files.
- [ ] **Step 2: Run to verify they fail,** implement ports and memory, run to verify they pass.
- [ ] **Step 3: Write `firebase.ts`** by the pattern of `runs/firebase.ts` (thin; no tests here; exercised in Task 14). `npm run build` must still pass.
- [ ] **Step 4: Commit** `feat: graph store ports, in-memory fakes and Firebase adapters`.

---

### Task 10: Graph service, part 1: graphs and files

**Files:** Create `web/src/lib/graph/starter.ts`, `service.ts`, `service.test.ts`. Modify `web/src/lib/runs/service.ts` (export `randomId`).

**Interfaces:**
- Consumes: store ports, `parseGraph`, `RunService`, `sniffKind`, `readImage`, `checkGlb`, `NODE_SPECS`.
- Produces: `starterGraph(): Graph` (nodes `n1` reference-image, `n2` palette-from-image, `n3` game-template with tuning 6 / 2.2 / 12, `n4` preview, `n5` an unconnected model; edges `n1.image→n2.image`, `n2.palette→n3.palette`, `n3.settings→n4.settings`); `makeGraphService(deps: { records: GraphRecords; files: GraphFiles; runs: RunService; now: () => number; newId?: () => string; executors?: Record<string, Executor> }): GraphService` with, so far, `createGraph(user, input: { name?: string; starter?: boolean }): Promise<GraphRecord>`, `listGraphs(user)`, `getGraph(user, id)`, `saveGraph(user, id, input: { name?: string; graph: unknown })`, `deleteGraph(user, id)`, `addAsset(user, id, name, bytes): Promise<{ sha256: string } & AssetInfo>`, `readAsset(user, id, sha256): Promise<{ bytes: Uint8Array; contentType: string }>`.

- [ ] **Step 1: Write the failing tests** (memory stores, `MemoryRunRecords` for `runs`, `newId` counter).
  - The starter graph parses through `parseGraph`. `createGraph` makes the starter or an empty graph; an 11th gives `GraphError(409, "You have 10 graphs. Delete one first.")`; a name is trimmed and cut to 80, empty gives "Untitled game".
  - Everything else on someone else's graph, a missing graph or a malformed id throws the same `GraphError(404, "Not found")`, for `getGraph`, `saveGraph`, `deleteGraph`, `addAsset` and `readAsset`.
  - `saveGraph`: an invalid graph gives `GraphError(400)` carrying the `parseGraph` message; an `asset` hash not uploaded to this graph gives 400; a model asset on a reference-image node gives 400; a file unreferenced for more than 5 minutes (advance `now`) is removed from the record and the file store on save, a referenced one is kept.
  - `addAsset`: a PNG gives `{sha256, name, size, kind: "image", contentType: "image/png", width, height}`; a GLB (`makeGlb`) gives kind `model` and `model/gltf-binary`; random bytes named `photo.png` give 400 "not a PNG, JPEG or GLB file"; an oversize-pixel PNG gives 400; a malformed GLB gives the `checkGlb` message.
  - **Review Focus 5:** the same bytes uploaded under two names keep one record with the first name; the name `"../../x\u0000<script>" + "a".repeat(300)` is stored with no control characters, at most 100 characters and no path separators; the 21st distinct file gives 409, except that unreferenced files older than 5 minutes are cleaned first.
  - `readAsset` returns the bytes and content type; an unknown hash gives 404. `deleteGraph` removes the graph, its files and its last run (a missing run is ignored).
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass; mutation-check the uniform 404 and the magic-byte sniffing (the name must never decide the kind).
- [ ] **Step 3: Commit** `feat: graph service (graphs, files, ownership, caps)`.

---

### Task 11: Graph service, part 2: Play

**Files:** Modify `web/src/lib/graph/service.ts`. Create `web/src/lib/graph/play.test.ts`.

**Interfaces:**
- Consumes: `checkGraph`, `runGraph`, `EXECUTORS`, `parseGraph`, the Task 10 service.
- Produces: `play(user: User, id: string): Promise<PlayResult>` on `GraphService`, where `PlayResult = { kind: "invalid"; problems: Problem[] } | { kind: "ran"; result: RunResult; runId?: string }`.

- [ ] **Step 1: Write the failing tests** (real executors, memory stores, a real `RunService` over memory).
  - Starter with a PNG chosen (via `addAsset` and `saveGraph`): `play` gives `kind: "ran"`, state `done`, a `runId`; the run is `ready`; its `settings.json`, read through `runs.readFile`, has the palette `makePalette` gives for that picture; `lastRunId` is stored on the record.
  - A second `play` leaves one run and updates `lastRunId`.
  - Starter with no picture chosen gives `kind: "invalid"` with `[{ node: "n1", message: "Reference Image: choose a picture." }]` and creates nothing.
  - Tuning 4 / 2.35 (a failing Game Template) gives `kind: "ran"`, state `failed`, `n3` failed, `n4` skipped, and `lastRunId` unchanged.
  - With a GLB asset wired to `n3.hero` (`saveGraph` of a graph with the extra edge), the run's `hero.glb` bytes equal the uploaded GLB and the other two equal the built-in ones.
  - Play reads the saved graph: editing without saving does not affect it. Someone else's graph gives 404.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass. `play`: re-parse the stored graph; `checkGraph`; build the context (`readAsset` through the file store, `lastRun` over a holder seeded from `record.lastRunId`); `runGraph`; if the holder changed, `records.setLastRunId`; take `runId` from the Preview node's `result`.
- [ ] **Step 3: Commit** `feat: Play runs the saved graph and keeps one run per graph`.

---

### Task 12: API handlers and routes

**Files:** Create `web/src/lib/api/guard.ts`, `web/src/lib/graph/api.ts`, `api.test.ts`, `web/src/lib/graph/firebase.ts`, routes `web/src/app/api/graphs/route.ts`, `[id]/route.ts`, `[id]/assets/route.ts`, `[id]/assets/[sha]/route.ts`, `[id]/play/route.ts`. Modify `web/src/lib/api/handlers.ts`, `web/src/lib/api/server.ts`, possibly `web/next.config.ts`.

**Interfaces:**
- Consumes: `GraphService`, `GraphError`, `requireUser`, `readSessionCookie`, `sameOrigin`, `readBodyCapped`, `TooLargeError`, `describeFailure`.
- Produces: `makeGuard({ auth, domain, label, publicError })` in `guard.ts` (the `guarded` function now inside `handlers.ts`: origin check for changes, `requireUser`, uniform 401 "Your session has expired. Sign in again.", a recognised error becomes its status and message, anything else a logged 500 "Something went wrong on our side"); `makeGraphApi({ auth, graphs, domain })` with `listGraphs(req)`, `createGraph(req)`, `getGraph(req, id)`, `saveGraph(req, id)`, `deleteGraph(req, id)`, `addAsset(req, id)`, `getAsset(req, id, sha)`, `play(req, id)`; `getGraphApi()` and `getGraphService()`.

- [ ] **Step 1: Extract the guard.** Move `guarded` out of `makeApi` into `guard.ts` without changing behavior; run `npx vitest run src/lib/api` and expect the existing 'handlers' and 'sessionHandlers' tests to pass unchanged.
- [ ] **Step 2: Write the failing tests** in `api.test.ts`, in the style of `lib/api/handlers.test.ts` (`MemoryAuth`, memory stores, a real service).
  - Signed out: every handler answers 401 with the same message. A `POST`, `PUT` or `DELETE` with a missing or foreign `Origin` answers 403, including `addAsset` and `play`.
  - A second person gets the uniform 404 from every handler on the first person's graph and asset.
  - Bodies: a `PUT` over 64 KB gives 413 "The graph is larger than 64 KB"; an upload over 4 MB gives 413 "<name>: larger than 4 MB"; invalid JSON gives 400; a graph that fails `parseGraph` gives 400 with its message.
  - `addAsset` takes the file name from `?name=` and returns `{sha256, name, size, kind}`; `getAsset` returns the bytes with `Content-Type` of the asset, `X-Content-Type-Options: nosniff` and `Cache-Control: private`.
  - `play` gives 422 with `{problems}` for an incomplete graph and 200 with `{state, order, nodes, runId}` for a run; responses never include `ownerUid` or `ownerEmail`.
  - A service method that throws `new Error("secret-bytes")` gives 500 "Something went wrong on our side", and neither the response nor `console.error`'s arguments contain `secret-bytes`.
- [ ] **Step 3: Run to verify they fail,** implement the handlers, run to verify they pass; mutation-check the origin check on `addAsset` and `play`, and the 64 KB cap.
- [ ] **Step 4: Write the five route files** as thin wrappers (`const { id } = await params`, as in `app/api/runs/[id]/files/[name]/route.ts`). Read the Next.js route handler docs in `node_modules/next/dist/docs/` first; the play route exports `maxDuration = 60`.
- [ ] **Step 5: Check the build.** `npm run build`: if `sharp` is not bundled or the build warns about it, add `serverExternalPackages: ["sharp"]` to `next.config.ts`. Then run the full gate (`npm test`, `npm run lint`, `npm run build`).
- [ ] **Step 6: Commit** `feat: graph API routes, with the request guard shared with runs`.

---

### Task 13: The plain page

**Files:** Create `web/src/lib/graph/edits.ts`, `edits.test.ts`, `web/src/app/graphs/page.tsx`, `NewGraphButton.tsx`, `web/src/app/graphs/[id]/page.tsx`, `GraphPlain.tsx`. Modify `web/src/app/page.tsx` (a link to `/graphs`).

**Interfaces:**
- Consumes: `Graph`, `Tuning`, `NODE_SPECS`, the API routes, the page patterns in `web/src/app/page.tsx` and `web/src/app/runs/new/UploadForm.tsx`.
- Produces: `setAsset(graph: Graph, nodeId: string, sha256: string | null): Graph` and `setTuning(graph: Graph, nodeId: string, tuning: Tuning): Graph` (new graph, input untouched; an unknown node id returns the graph unchanged).

- [ ] **Step 1: Write the failing tests** for `setAsset` and `setTuning`: only the named node changes; the input graph is not mutated; an unknown node id returns an equal graph.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Build the pages** (server pages call `currentUser()` and redirect to `/sign-in` when null, load through `getGraphService()`). `/graphs`: the person's graphs (name, updated time, Open, Delete) and "New from starter". `/graphs/{id}` (client component `GraphPlain`): each node as a list item showing its plain name and id; a file picker on Reference Image and 3D Model nodes that uploads (4 MB checked first), then sets the node's asset and saves; number fields for the Game Template tuning; a text box with the graph JSON and a Save button (the only way to wire a second model or try a bad graph); a Play button that saves the current graph first and stops if the save fails; the per-node results in run order with state words and the plain-word errors, plus a "not used" line for unrun nodes; the problems list for a 422; a link to `/runs/{runId}/preview` when a run exists. A 401 anywhere goes to `/sign-in`.
- [ ] **Step 4: Run the full gate** (`npm test`, `npm run lint`, `npm run build`); all pass and the build lists the new routes.
- [ ] **Step 5: Commit** `feat: plain graph pages (list, edit, play, results)`.

---

### Task 14: Deployed acceptance and wrap-up (needs the slice 2 deployment)

Blocked on the user's Vercel and Firebase setup (see `docs/superpowers/notes/slice2-handoff.md`). Tasks 1 to 13 do not need it.

**Files:** Create `docs/superpowers/notes/slice3a-results.md`. Modify `CLAUDE.md`, `docs/superpowers/notes/slice2-handoff.md` (or a new `slice3a-handoff.md`).

- [ ] **Step 1: Deploy the branch** and confirm slice 2's own checks first (they come first).
- [ ] **Step 2: `sharp` on Vercel.** On the deployment, create the starter graph, upload a picture and press Play. If the function fails to load `sharp`, fix per Risk 1 of the spec (`serverExternalPackages`, or the pure-JavaScript fallback decoders) with a failing test first.
- [ ] **Step 3: The seven done-criteria** of the spec, each with the result recorded: (1) signed out, every graph page and API is refused; (2) starter plus a picture, Play, and the preview game has that picture's colors, on a desktop and on a phone (this also closes slice 1's phone check); (3) the same with their own GLB wired to the hero, through the JSON box; (4) a missing picture, a wrong wire type (refused on save), a `.png` that is not an image, an oversized image, unplayable tuning (4 / 2.35), each refused in plain words naming the node; (5) a second account cannot reach the first one's graph, file or run; (6) Play twice leaves one run; (7) no secret is in the repository (scan the diff for keys, `.env` values and personal paths).
- [ ] **Step 4: Fix any Firebase-adapter bug** with a failing port test first (Task 9's contract tests).
- [ ] **Step 5: Write the results note, update `CLAUDE.md` and the handoff,** then finish the branch with the user per `finishing-a-development-branch` (merge order: slice 1, slice 2, then this). Slice 3b (the canvas) is brainstormed next, using `docs/superpowers/notes/slice3-editor-reference.md`.
- [ ] **Step 6: Commit** `docs: slice 3a results`.
