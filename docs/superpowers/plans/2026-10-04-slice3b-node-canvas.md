# Slice 3b: Node Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain graph page with a node canvas: steps as cards with their results on them, typed wires refused in plain words, a settings panel, autosave, Play, and a game view the person chooses (docked, floating or full), with a dark theme and a light option.

**Architecture:** The 3a `Graph` JSON is the single source of truth, held in a reducer; React Flow only draws it. Every canvas action is a small pure edit of the graph (in `web/src/lib/graph/edits.ts` and `web/src/lib/canvas/`), so every rule is plain TypeScript tested without a browser. Components stay thin: they hold state, call the units, and render. No server changes.

**Tech Stack:** TypeScript, Next.js 16.3.8 (App Router), React 19.2.8, `@xyflow/react` 12.12, Vitest (render tests with `react-dom/server`), CSS modules with CSS variables.

**Spec:** `docs/superpowers/specs/2026-10-04-node-canvas-design.md` (read it first). The engine it sits on: `docs/superpowers/specs/2026-10-03-graph-engine-design.md` and `web/src/lib/graph/`.

## Global Constraints

- Work in `web/`, on branch `slice-3b-node-canvas` (cut from `slice-3a-graph-engine`). Git Bash needs `export PATH="/c/Program Files/nodejs:$PATH"`. Tests: `npx vitest run <path>`; the gate is `npm test`, `npm run lint`, `npm run build`, stopping at the first failure. Baseline before Task 1: 432 tests passing.
- `web/AGENTS.md`: this Next.js has breaking changes; read the relevant guide in `web/node_modules/next/dist/docs/` before writing a page or route. Before writing CSS (Task 11) invoke the `frontend-design` skill.
- Test first; mutation-check the wire rule, the stale-results rule and autosave's flush: after the test passes, break the rule once, see a test fail, restore it. Every commit message ends with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never push; the repo is public, so no secrets or personal paths in anything committed.
- `web/src/lib/graph/` and `web/src/lib/canvas/` stay pure: no React, no DOM, no `window`; type-only imports from `@xyflow/react` are allowed. No server changes, no new environment variables, no new test dependencies. The editor is desktop only.
- Values, verbatim from the spec: autosave delay 800 ms; results reveal 150 ms apart (capped so a whole reveal takes at most 1500 ms; none when reduced motion is preferred); floating game window minimum 240 × 160; at most 50 steps and 200 wires; preferences key `gsp.prefs`; theme `dark` by default, `light` optional; game view `docked` by default, `floating`, `full`. Wire colors: picture `#f59e0b`, 3D model `#3b82f6`, palette `#8b5cf6`, game `#10b981`. The plain words for wire types are `picture`, `3D model`, `palette`, `game` (`WIRE_WORDS` in `registry.ts`).
- Exact sentences: "A palette can't go into a picture input." (pattern: "A <plain word> can't go into a <plain word> input."); "Preview's game input already has a wire. Remove it first." (pattern: "<node label>'s <port label> input already has a wire. Remove it first."); "A step can't connect to itself."; "A graph can have at most 50 steps."; "A graph can have at most 200 wires."; "A graph has one Preview."; "Press Play to see your game here."; "Out of date: press Play."; "Your session has expired. Sign in again."; "Couldn't save: <reason>"; "Not connected to a Preview"; "Without a hero model, a built-in shape is used."

## Review Focus

Inputs a person will meet that the spec does not spell out. Each has a test in the task named.

1. Deleting a step and adding another reuses the lowest unused id: the old step's wires must not come back (Task 3).
2. A slider's float noise (`2.3000000000000003`) is stored as `2.3` (Task 3).
3. New steps added at the same spot never stack on top of each other (Task 3).
4. A 50-step graph's reveal after Play takes at most 1.5 s, not 7.5 s (Task 5).
5. A file name with `<script>`, 300 characters or right-to-left marks is escaped on a card and in the panel, and is cut off by CSS rather than breaking the layout (Tasks 11 and 12).

---

## File Structure

```
web/src/lib/graph/   wiring.ts (2)  edits.ts (3, extended)  walk.ts (4, + descendants)  schema.ts (2, uses wiring)
web/src/lib/canvas/  stepNumbers.ts (4)  runView.ts, editorState.ts (5)  autosave.ts (6)  prefs.ts (7)
                     tuning.ts, addMenu.ts (8)  cardView.ts (9)  flow.ts (10)
web/src/app/graphs/[id]/  StepCardView.tsx, StepCard.tsx, WireEdge.tsx, icons.tsx, editor.module.css (11)
                     SettingsPanel.tsx, AddMenu.tsx (12)  Toolbar.tsx, GamePanel.tsx (13)  Editor.tsx (14, 15)  page.tsx (15)
web/src/app/graphs/page.tsx (15, restyled)      GraphPlain.tsx (removed in 15)
```

---

### Task 1: React Flow and render-test setup

**Files:** Modify `web/package.json`, `package-lock.json`, `web/vitest.config.mts`. Temporary (deleted in this task): `web/src/test/flow-smoke.test.tsx`, `web/src/test/smoke.module.css`, `web/src/app/flow-smoke/page.tsx`.

- [ ] **Step 1: Add the dependency.** `cd web && npm install @xyflow/react@^12.12.0` (the spec approves it; the package's peer range is `react >= 17`). Expected: it appears under `dependencies`.
- [ ] **Step 2: Write the failing smoke test** `flow-smoke.test.tsx`: `renderToString` of `<ReactFlow nodes={[{id:"a",position:{x:0,y:0},data:{label:"Hello"}}]} edges={[]} width={400} height={300} />` contains `Hello`; and a small component importing `smoke.module.css` (one class) renders with a non-empty class name from the module.
- [ ] **Step 3: Run it.** `npx vitest run src/test` fails ("No test files found": `vitest.config.mts` includes only `.test.ts`). Change `include` to `["src/**/*.test.{ts,tsx}"]`. Run again; if the CSS module import is the failure, add `css: { include: /\.module\.css$/ }` to the `test` options. Expected: both assertions pass.
- [ ] **Step 4: Prove it in a production build.** Create the temporary `app/flow-smoke/page.tsx` (a `"use client"` component rendering a two-node `<ReactFlow>` with `import "@xyflow/react/dist/style.css"`). `npm run build` must pass and list the route.
- [ ] **Step 5: Remove the three temporary files,** run `npm test` (432 pass), commit `build: add @xyflow/react and tsx render tests`.

---

### Task 2: The wire rule

**Files:** Create `web/src/lib/graph/wiring.ts`, `wiring.test.ts`. Modify `schema.ts`, `schema.test.ts`.

**Interfaces:**
- Consumes: `NODE_SPECS`, `NodeSpec`, `WIRE_WORDS` (`registry.ts`); `GraphNode`, `GraphEdge` (`types.ts`).
- Produces: `wiringProblem(nodes: GraphNode[], existing: GraphEdge[], edge: GraphEdge, specs?: Record<string, NodeSpec>): string | null`. `existing` is the wires already accepted; the result is a plain sentence or `null`.

- [ ] **Step 1: Write the failing tests** (`wiring.test.ts`, nodes from the starter shape): an accepted wire gives `null`; a wire to an unknown node gives `A wire refers to a node that does not exist ("zz").`; an unknown port gives `Node n2 (Palette from Image) has no port "nope".`; from an input gives `"image" on Palette from Image is an input, not an output.`; into an output gives `"palette" on Palette from Image is an output, not an input.`; wrong types (`it.each`): palette into a picture input gives exactly `A palette can't go into a picture input.`, a 3D model into a picture input gives `A 3D model can't go into a picture input.`, a picture into a palette input gives `A picture can't go into a palette input.`; an occupied input gives exactly `Preview's game input already has a wire. Remove it first.`; the same wire twice gives that same sentence; a wire from a step to itself (a made-up spec map whose type has an output and input of one wire type) gives `A step can't connect to itself.`; `existing` is not modified.
- [ ] **Step 2: Run to verify they fail.** `npx vitest run src/lib/graph/wiring.test.ts`.
- [ ] **Step 3: Implement `wiringProblem`** by moving the body of `checkWiring` out of `schema.ts` (checks in order: nodes exist, self-connection, output port, input port, type, occupied input) and returning the sentence instead of refusing. In `schema.ts` the edge loop keeps a list of accepted wires, calls `wiringProblem(nodes, accepted, edge, specs)`, refuses with its sentence, then pushes the edge.
- [ ] **Step 4: Update `schema.test.ts`.** The two rows that expected `/more than one wire/` now expect `/already has a wire/`. `npx vitest run src/lib/graph` all pass; mutation-check by removing the occupied-input check and the type check once each.
- [ ] **Step 5: Commit** `feat: one wire rule shared by the parser and the canvas`.

---

### Task 3: Graph edits

**Files:** Modify `web/src/lib/graph/edits.ts`, `edits.test.ts`.

**Interfaces:**
- Consumes: `wiringProblem`, `NODE_SPECS`, `MAX_NODES`, `MAX_EDGES` (`schema.ts`), `Graph`, `GraphEdge`, `Tuning`, existing `setAsset`, `setTuning`.
- Produces: `Edit = { graph: Graph; touched: string[] }` (`touched` is the ids of steps whose results an edit makes out of date); `addProblem(graph, type, specs?): string | null` (a sentence, or null when a step of that type may be added); `addNode(graph, type, near: {x:number;y:number}, specs?): ({ ok: true; id: string } & Edit) | { ok: false; reason: string }`; `removeNode(graph, id): Edit`; `addEdge(graph, edge, specs?): ({ ok: true } & Edit) | { ok: false; reason: string }`; `removeEdge(graph, edge): Edit`; `moveNode(graph, id, position): Edit`; `editAsset(graph, nodeId, sha256: string | null): Edit`; `editTuning(graph, nodeId, tuning: Tuning): Edit`.

- [ ] **Step 1: Write the failing tests.**
  - `addProblem`: null for a model on a small graph; "A graph has one Preview." when a Preview exists and the type is `preview`; "A graph can have at most 50 steps." with 50 nodes; a message for an unknown type.
  - `addNode`: gives the lowest unused id `n<k>` and the type's `defaultParams()`; the input graph is not changed; `touched` is `[]`; it refuses with the `addProblem` reason.
  - **Review Focus 1:** remove step `n3` (which had wires), then add a step: it gets id `n3`, and none of the old `n3` wires are in the graph.
  - **Review Focus 3:** five `addNode` calls with the same `near` give five distinct positions, each at least 140 px from every other in y or 200 px in x.
  - `removeNode`: removes the step and every wire touching it; `touched` is the steps it fed (not itself); an unknown id returns an equal graph and `[]`.
  - `addEdge`: accepted wire gives `touched: [edge.to.node]`; a refused wire gives the `wiringProblem` sentence; refuses a 201st wire with "A graph can have at most 200 wires."
  - `removeEdge`: removes the wire, `touched: [to.node]`; a wire that is not there changes nothing and gives `[]`. `moveNode`: sets the position, `touched: []`.
  - `editAsset` and `editTuning` wrap `setAsset` and `setTuning` with `touched: [nodeId]`. **Review Focus 2:** `editTuning` with `speed: 2.3000000000000003` stores `2.3` (every value is rounded to 2 decimal places).
- [ ] **Step 2: Run to verify they fail,** implement (new position: try `near`, then `near` plus multiples of 140 px down until no step is within 140 px in y and 200 px in x), run to verify they pass.
- [ ] **Step 3: Commit** `feat: graph edits for the canvas (add, remove, wire, move)`.

---

### Task 4: Step numbers and staleness

**Files:** Modify `web/src/lib/graph/walk.ts`. Create `web/src/lib/graph/walk.test.ts`, `web/src/lib/canvas/stepNumbers.ts`, `stepNumbers.test.ts`.

**Interfaces:**
- Produces: `descendants(graph: Graph, roots: string[]): Set<string>` (the roots and everything downstream, mirroring `ancestors`); `stepNumbers(graph: Graph, specs?): Map<string, number>` (the steps that lead to the Preview, numbered from 1 in `orderNodes` order; empty when there is no Preview or a loop); `staleAfter(graph: Graph, touched: string[]): Set<string>` (the touched steps that exist, and everything downstream of them).

- [ ] **Step 1: Write the failing tests.** `descendants`: a chain, a fan-out, roots included, unrelated nodes left out. `stepNumbers`: the starter graph gives n1 to n4 numbered 1 to 4 and no number for the unconnected n5; wiring n5 to the hero changes the numbering and gives n5 a number before n3; a graph with no Preview gives an empty map. `staleAfter`: touching `n2` gives `n2, n3, n4`; touching an unknown id gives an empty set.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass; mutation-check `staleAfter` by dropping the downstream part.
- [ ] **Step 3: Commit** `feat: step numbers and the results an edit makes stale`.

---

### Task 5: Run view and editor state

**Files:** Create `web/src/lib/canvas/runView.ts`, `runView.test.ts`, `editorState.ts`, `editorState.test.ts`.

**Interfaces:**
- Consumes: `NodeOutcome` (`runner.ts`), `Problem`, `Graph`, `Assets`, `GraphEdge` (`types.ts`), `staleAfter`, `stepNumbers`, `NODE_SPECS`.
- Produces in `runView.ts`: `PlayResponse = { kind: "ran"; state: "done" | "failed"; order: string[]; nodes: Record<string, NodeOutcome>; runId?: string } | { kind: "invalid"; problems: Problem[] }`; `RunView = { runId: string | null; order: string[]; outcomes: Record<string, NodeOutcome>; problems: Problem[]; stale: string[]; ranOnce: boolean }`; `emptyRunView(runId: string | null): RunView`; `finalNodeId(graph, specs?): string | null`; `applyPlay(view, graph, response): RunView`; `markStale(view, graph, touched: string[]): RunView`; `isOutOfDate(view, graph): boolean` (true when a stale step leads to the Preview); `revealSchedule(order: string[], delayMs: number, reducedMotion: boolean): { node: string; atMs: number }[]` (delay is `min(delayMs, 1500 / order.length)`; all at 0 when reduced motion).
- Produces in `editorState.ts`: `Selection = { kind: "none" } | { kind: "node"; id: string } | { kind: "edge"; edge: GraphEdge }`; `EditorState = { graph: Graph; assets: Assets; run: RunView; selection: Selection; playing: boolean; hintOpen: boolean; toast: string | null }`; `EditorAction` = `{ type: "edited"; graph: Graph; touched: string[] }` | `{ type: "assets"; assets: Assets }` | `{ type: "select"; selection: Selection }` | `{ type: "play-started" }` | `{ type: "play-finished"; response: PlayResponse }` | `{ type: "play-failed" }` | `{ type: "toast"; message: string | null }`; `initialEditorState(record: { graph: Graph; assets: Assets; lastRunId: string | null }): EditorState`; `editorReducer(state, action): EditorState`.

- [ ] **Step 1: Write the failing tests.**
  - `applyPlay` ran: outcomes, order and `runId` come from the response, `problems` empty, `stale` empty, `ranOnce` true. If the response has no `runId` and the Preview's outcome is `failed`, `runId` becomes `null`; if the Preview was skipped, the earlier `runId` is kept. Invalid: `problems` set, `outcomes` empty, `runId` unchanged.
  - `markStale`: removes the outcomes and problems of stale steps and lists them; steps not downstream keep theirs. `isOutOfDate`: false after `applyPlay`; true after touching an upstream step; false when only the unconnected step was touched.
  - `revealSchedule`: three steps get `0,150,300`; **Review Focus 4:** 50 steps finish by 1500 ms; reduced motion gives all `0`.
  - `editorReducer`: `edited` replaces the graph and stale-marks the run; it clears a selection whose step or wire is gone; `play-started` sets `playing`; `play-finished` applies the response, clears `playing`, and closes the hint after a `done` run (not after a failed or invalid one); `initialEditorState` opens the hint only when `lastRunId` is `null`.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: run view and editor state`.

---

### Task 6: Autosave

**Files:** Create `web/src/lib/canvas/autosave.ts`, `autosave.test.ts`.

**Interfaces:**
- Produces: `SaveResult = { ok: true } | { ok: false; message: string; retryable: boolean }`; `SaveState = { status: "idle" | "dirty" | "saving" | "saved" } | { status: "error"; message: string; retryable: boolean }`; `Autosave = { state(): SaveState; subscribe(listener: (state: SaveState) => void): () => void; edit(graph: Graph): void; flush(): Promise<boolean>; retry(): void; dispose(): void }`; `createAutosave(options: { save: (graph: Graph) => Promise<SaveResult>; delayMs: number; timers?: { set(fn: () => void, ms: number): unknown; clear(handle: unknown): void } }): Autosave` (injectable timers, so tests control time).

- [ ] **Step 1: Write the failing tests** with fake timers and a `save` whose promise the test resolves:
  - Three `edit` calls inside the delay give one `save`, with the last graph; the state goes `dirty` then `saving` then `saved`.
  - An `edit` while saving does not start a second save at once; when the first finishes, the latest graph is saved too.
  - A failed save gives `error` with its message and no further save until a new `edit` or `retry()`; a non-retryable refusal does not loop (one `save` call per `edit`).
  - `retry()` after an error saves the latest graph and ends `saved`.
  - `flush()` with a pending edit saves now and resolves `true`; while saving it waits and then saves anything newer; with nothing pending it resolves `true` at once; after an error it resolves `false`.
  - `subscribe` gets each state change in order and the returned function unsubscribes; `dispose()` clears the timer so nothing saves afterwards.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass; mutation-check `flush` (make it skip waiting) once.
- [ ] **Step 3: Commit** `feat: autosave with visible states`.

---

### Task 7: Preferences and window geometry

**Files:** Create `web/src/lib/canvas/prefs.ts`, `prefs.test.ts`.

**Interfaces:**
- Produces: `Theme = "dark" | "light"`; `GameView = "docked" | "floating" | "full"`; `Rect = { x: number; y: number; width: number; height: number }`; `Prefs = { theme: Theme; gameView: GameView; floating: Rect }`; `PREFS_KEY = "gsp.prefs"`; `DEFAULT_PREFS: Prefs` (dark, docked, floating `{ x: 24, y: 96, width: 320, height: 420 }`); `loadPrefs(storage: Pick<Storage, "getItem"> | null): Prefs`; `savePrefs(storage: Pick<Storage, "setItem"> | null, prefs: Prefs): void`; `clampRect(rect: Rect, viewport: { width: number; height: number }): Rect` (at least 240 × 160, kept inside the viewport); `moveRect(rect, dx, dy, viewport): Rect`; `resizeRect(rect, dw, dh, viewport): Rect`.

- [ ] **Step 1: Write the failing tests.** `loadPrefs`: `null` storage, a missing key, junk JSON, and a wrong type for any one field each fall back to that field's default while valid fields are kept; a saved value round-trips; a `getItem` that throws gives the defaults. `savePrefs`: writes JSON under `gsp.prefs`; a `setItem` that throws (private mode, quota) does not throw; `null` storage does nothing. Geometry: `clampRect` never goes below 240 × 160 or outside the viewport; `moveRect` stops at the edges; `resizeRect` respects the minimum and the viewport.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: preferences and window geometry`.

---

### Task 8: Tuning check and add choices

**Files:** Create `web/src/lib/canvas/tuning.ts`, `tuning.test.ts`, `addMenu.ts`, `addMenu.test.ts`.

**Interfaces:**
- Consumes: `validateSettings`, `SAMPLE_PALETTE`, `ROLE_FILES`, `Tuning`, `addProblem`, `NODE_SPECS`, `PortRef`.
- Produces: `TUNING_FIELDS: readonly { key: keyof Tuning; label: string; min: number; max: number; step: number; unit: string }[]` (labels "How fast it runs" 1 to 20 in m/s, "How high it jumps" 1.5 to 5 in m, "How far apart the obstacles are" 4 to 40 in m); `tuningProblem(tuning: Tuning): string | null` (the slice 2 message Play would give, with the technical path `settings.tuning.<key>:` replaced by the field's plain label); `Choice = { type: string; label: string; help: string; disabledReason?: string; wireInto?: string }`; `addChoices(graph: Graph, from?: PortRef, specs?): Choice[]` (every node type with `disabledReason` from `addProblem`; given an open output `from`, only the types with an input of that wire type, each with `wireInto` set to its first such input).

- [ ] **Step 1: Write the failing tests.** `tuningProblem`: the tuning of `fixtures/settings/valid.json` gives `null`; the tunings of `invalid-unwinnable-jump.json` and `invalid-unwinnable-spacing.json` give a message that starts with the plain label ("How high it jumps: ..." or "How far apart the obstacles are: ...") and does not contain `settings.tuning`; `valid-range-max.json` gives `null`. `addChoices`: no `from` gives five choices with names and help from `NODE_SPECS`; with a Preview in the graph the `preview` choice has `disabledReason` "A graph has one Preview."; at 50 steps every choice is disabled with "A graph can have at most 50 steps."; `from` a picture output gives only Palette from Image with `wireInto: "image"`; a palette output gives Game Template with `wireInto: "palette"`; a 3D model output gives Game Template with `wireInto: "hero"`; a game output gives Preview.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: live tuning check and the add-step choices`.

---

### Task 9: Card view model

**Files:** Create `web/src/lib/canvas/cardView.ts`, `cardView.test.ts`.

**Interfaces:**
- Consumes: `GraphNode`, `Graph`, `Assets`, `NODE_SPECS`, `RunView`, `Problem`, `WireType`.
- Produces: `StepStatus = "idle" | "running" | "done" | "skipped" | "failed" | "not-used" | "attention"`; `PortView = { name: string; label: string; type: WireType; required: boolean; wired: boolean }`; `ResultView = { kind: "none" } | { kind: "image"; name: string; thumbUrl: string } | { kind: "model"; name: string; size: string } | { kind: "palette"; colors: string[] } | { kind: "text"; text: string } | { kind: "open-game" }`; `StepData = { id: string; type: string; label: string; help: string; number: number | null; status: StepStatus; statusText: string; result: ResultView; inputs: PortView[]; outputs: PortView[] }`; `formatSize(bytes: number): string` ("512 B", "1.5 KB", "1.2 MB"); `stepData(args: { graph: Graph; node: GraphNode; assets: Assets; run: RunView; numbers: Map<string, number>; graphId: string; pending: ReadonlySet<string>; specs?: Record<string, NodeSpec> }): StepData`.

- [ ] **Step 1: Write the failing tests.**
  - Status: a step with no number is `not-used` with "Not connected to a Preview"; a numbered step in `pending` is `running` ("Running…"); outcomes map to `done` ("Done"), `failed` (its error), `skipped` (its `because`); a step named in `run.problems` is `attention` with the sentence minus its "<label>: " prefix and capitalized ("Choose a picture."); a numbered step with nothing yet is `idle` with empty text.
  - Results: a chosen picture gives `{kind:"image", name, thumbUrl: "/api/graphs/<id>/assets/<sha>"}` before any Play; a chosen model gives its name and `formatSize(size)`; a done Palette from Image gives its five colors; a done Game Template gives `speed 6 · jump 2.2 · spacing 12`; a done Preview with a `runId` gives `open-game`; a stale step (outcome cleared) shows no result except a chosen file.
  - Ports: Game Template's four inputs carry their plain labels and `required: false`; `wired` is true for connected inputs and outputs; `formatSize` thresholds.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: card view model`.

---

### Task 10: Flow mapping

**Files:** Create `web/src/lib/canvas/flow.ts`, `flow.test.ts`.

**Interfaces:**
- Consumes: `stepData`, `Graph`, `GraphEdge`, `Selection`, `WIRE_WORDS`, and the types `NodeChange`, `EdgeChange` from `@xyflow/react` (type-only).
- Produces: `FlowNode = { id: string; type: "step"; position: { x: number; y: number }; data: StepData; selected: boolean }`; `FlowEdge = { id: string; type: "wire"; source: string; target: string; sourceHandle: string; targetHandle: string; selected: boolean; data: { word: string; wire: WireType } }`; `edgeId(edge: GraphEdge): string`; `toFlow(args: <the stepData args except node> & { selection: Selection }): { nodes: FlowNode[]; edges: FlowEdge[] }`; `connectionToEdge(c: { source: string | null; sourceHandle?: string | null; target: string | null; targetHandle?: string | null }): GraphEdge | null` (null when incomplete); `graphFromNodeChanges(graph: Graph, changes: NodeChange[]): { graph: Graph; touched: string[]; selected: string | null | undefined }` (position changes become `moveNode`, removals `removeNode`, a select change reports the selected step; everything else is ignored); `graphFromEdgeChanges(graph: Graph, changes: EdgeChange[]): { graph: Graph; touched: string[]; selected: GraphEdge | null | undefined }`.

- [ ] **Step 1: Write the failing tests.** `toFlow` of the starter graph gives five `step` nodes with the saved positions and three `wire` edges whose handles are the port names, whose `word` is the plain word of the type, and whose ids are stable (`edgeId`); the selected step or wire is flagged. `connectionToEdge`: a full connection gives the `GraphEdge`; a missing target (dropped on empty canvas) gives `null`. `graphFromNodeChanges`: a position change moves the step and touches nothing; a remove deletes the step and its wires and reports the steps it fed; a select change reports the id; `dimensions` changes are ignored and return an equal graph. `graphFromEdgeChanges`: a remove deletes that wire and touches its target.
- [ ] **Step 2: Run to verify they fail,** implement, run to verify they pass.
- [ ] **Step 3: Commit** `feat: flow mapping between the graph and React Flow`.

---

### Task 11: Step card, wire and styles

**Files:** Create `web/src/app/graphs/[id]/StepCardView.tsx`, `StepCardView.test.tsx`, `StepCard.tsx`, `WireEdge.tsx`, `icons.tsx`, `editor.module.css`.

**Interfaces:**
- Consumes: `StepData`, `ResultView`, `StepStatus` (`cardView.ts`); `Handle`, `Position`, `NodeProps`, `EdgeProps`, `EdgeLabelRenderer`, `getBezierPath`, `useNodeConnections` or the store hooks from `@xyflow/react`.
- Produces: `StepCardView(props: { data: StepData; selected: boolean; onAddFrom?: (port: string) => void; onRemove?: () => void; onOpenGame?: () => void }): JSX.Element` (everything except the React Flow handles, so it renders without a flow; a × shows when `selected` and calls `onRemove`; the Preview's "Open game" result calls `onOpenGame`); `StepCard` (the registered node type `step`: `StepCardView` plus an input `Handle` per input and an output `Handle` per output, each handle colored by wire type and labeled, and a "+" button on an output with no wire; it reads an `EditorActions` React context defined in `StepCard.tsx`: `{ onAddFrom(nodeId: string, port: string): void; onRemoveNode(id: string): void; onRemoveEdge(edge: GraphEdge): void; onOpenGame(): void }` and passes the matching callbacks to `StepCardView`); `WireEdge` (the edge type `wire`: a colored bezier path, a pill with the plain word, and a × when selected that calls `onRemoveEdge` from the same context); `Icon(props: { type: string })` (a simple inline SVG per node type); the CSS module `editor.module.css` with the dark and light theme tokens as CSS variables under `[data-theme]` and the handle classes `connectingto` and `valid` styled so incompatible handles dim and compatible ones glow.

- [ ] **Step 1: Write the failing render tests** (`renderToString(<StepCardView .../>)`): the one-line help text is in the markup; the order number badge shows for a numbered step and not for `null`; each status shows its word (and, for `failed` and `attention`, the sentence); `not-used` is marked (a class or `aria-disabled`); the palette result shows five swatches with their hex as `title`; the image result shows an `<img>` whose `src` is the thumbnail URL and the file name; the model result shows name and size; the text result shows its text; a selected card shows its × and an unselected one does not; the `open-game` result shows "Open game"; **Review Focus 5:** a file name of `<script>alert(1)</script>` is escaped in the markup (no `<script>` tag), and a 300-character name is rendered whole with a class that truncates it with CSS (ellipsis), not cut in code.
- [ ] **Step 2: Run to verify they fail.** Then invoke the `frontend-design` skill and write the CSS module, the card, the wire and the icons to the look in the spec (dark dotted canvas, compact cards, help line visible, pills on wires, tick and spinner, red outline for failed, greyed for not used); states must be told apart by words and icons, not color alone; the spinner and reveal respect `prefers-reduced-motion`.
- [ ] **Step 3: Run to verify the render tests pass,** then `npm run lint` and `npm run build`.
- [ ] **Step 4: Commit** `feat: step card, wire and canvas styles`.

---

### Task 12: Settings panel and add menu

**Files:** Create `web/src/app/graphs/[id]/SettingsPanel.tsx`, `AddMenu.tsx`, `panels.test.tsx`.

**Interfaces:**
- Consumes: `StepData`, `GraphNode`, `Assets`, `Tuning`, `TUNING_FIELDS`, `tuningProblem`, `Choice`, `formatSize`, `NODE_SPECS`.
- Produces: `SettingsPanel(props: { node: GraphNode | null; data: StepData | null; assets: Assets; graphId: string; uploading: boolean; error: string | null; onChooseFile: (nodeId: string, file: File) => void; onTune: (nodeId: string, tuning: Tuning) => void }): JSX.Element`; `AddMenu(props: { choices: Choice[]; onPick: (choice: Choice) => void; onClose: () => void }): JSX.Element`.

- [ ] **Step 1: Write the failing render tests.** No node selected: a short hint ("Select a step to see its settings."). Reference Image: a file input accepting PNG and JPEG, the chosen file's thumbnail and name, and `error` shown; 3D Model: a file input accepting GLB, the name and size; Game Template: three range inputs with the labels, min, max and step from `TUNING_FIELDS`, each with its value, the `tuningProblem` sentence for an unplayable tuning (4 / 2.35) and none for 6 / 2.2 / 12, and the line "Without a hero model, a built-in shape is used."; Palette from Image and Preview: their help text. `AddMenu`: one button per choice with its name and help, a disabled one shows its `disabledReason` and is not clickable, an empty list says "No step fits here.". **Review Focus 5:** a hostile file name is escaped in the panel too.
- [ ] **Step 2: Run to verify they fail,** implement (file inputs and sliders are controlled by props; the 4 MB check is the editor's job in Task 15; the inputs inside cards or panels get the `nodrag` class where they sit on the canvas), run to verify they pass, then `npm run lint`.
- [ ] **Step 3: Commit** `feat: settings panel and add menu`.

---

### Task 13: Toolbar and game panel

**Files:** Create `web/src/app/graphs/[id]/Toolbar.tsx`, `GamePanel.tsx`, `chrome.test.tsx`.

**Interfaces:**
- Consumes: `SaveState`, `Theme`, `GameView`, `Rect`, `pickTemplate`, `previewUrl`, `clampRect`, `moveRect`, `resizeRect`.
- Produces: `Toolbar(props: { name: string; save: SaveState; theme: Theme; canPlay: boolean; playing: boolean; onPlay: () => void; onAddStep: () => void; onTheme: (theme: Theme) => void; onRetry: () => void }): JSX.Element` (name, the save indicator "Saving…" / "Saved" / "Couldn't save: <reason>" with a Retry button, "+ Add step", a theme switch, and a prominent Play button that reads "Playing…" while playing); `GameFrame(props: { runId: string | null; outOfDate: boolean; coarsePointer: boolean | null }): JSX.Element` (an iframe of the template for the run, "Press Play to see your game here." with no run, an "Out of date: press Play." badge when `outOfDate`, and nothing until `coarsePointer` is known); `GamePanel(props: { mode: GameView; rect: Rect; viewport: { width: number; height: number }; frame: JSX.Element; onMode: (mode: GameView) => void; onRect: (rect: Rect) => void; onClose?: () => void }): JSX.Element` (the three mode buttons; `docked` renders the frame in place, `floating` a fixed window with a draggable title bar and a corner resize handle using `moveRect` and `resizeRect`, `full` a fixed overlay with "← Back to canvas").

- [ ] **Step 1: Write the failing render tests.** Toolbar: each save state's text; the Retry button only in `error` and only when retryable; Play is disabled when `canPlay` is false; "Playing…" while playing. `GameFrame`: no run says "Press Play to see your game here."; a run renders an iframe whose `src` is `previewUrl(runId, "runner-desktop")` and, with `coarsePointer` true, the mobile template; `outOfDate` shows the badge; `coarsePointer` null renders nothing. `GamePanel`: the three mode buttons mark the current one; `full` shows "← Back to canvas".
- [ ] **Step 2: Run to verify they fail,** implement (pointer dragging with pointer events and `setPointerCapture`; keep rects clamped with the geometry units), run to verify they pass, then `npm run lint`.
- [ ] **Step 3: Commit** `feat: toolbar and game panel`.

---

### Task 14: Editor part 1: the canvas

**Files:** Create `web/src/app/graphs/[id]/Editor.tsx`.

**Interfaces:**
- Consumes: everything from Tasks 2 to 13.
- Produces: `Editor(props: { id: string; name: string; initialGraph: Graph; initialAssets: Assets; initialRunId: string | null }): JSX.Element` (client component). This task builds the canvas half; Task 15 adds saving, uploads, Play and the game view.

There are no new unit tests here (the rules are all in tested units); verification is typecheck, lint and build, and every callback below is a one-line call into a unit.

- [ ] **Step 1: Read the installed React Flow types** (`web/node_modules/@xyflow/react/dist/esm/types/`) for `FinalConnectionState`, `OnConnectEnd`, `deleteKeyCode` and `colorMode`, and use the real names.
- [ ] **Step 2: Build the canvas.** `ReactFlowProvider`, then a `Canvas` with `useReducer(editorReducer, initialEditorState({...}))`. Derive `numbers = stepNumbers(graph)` and `toFlow(...)` with `useMemo`. `<ReactFlow>` with `nodeTypes={{ step: StepCard }}`, `edgeTypes={{ wire: WireEdge }}`, `fitView`, `colorMode` from the theme, `Background` (dots) and `Controls`, `deleteKeyCode={["Delete", "Backspace"]}`, no `nodesConnectable` change.
- [ ] **Step 3: Wire the callbacks to the units.** `onNodesChange` and `onEdgesChange` call `graphFromNodeChanges` and `graphFromEdgeChanges` (named so they do not clash with React Flow's own functions) and dispatch `edited` (or `select`); `isValidConnection` is `wiringProblem(...) === null`; `onConnect` runs `addEdge` and dispatches `edited` or a `toast` with the refusal; `onConnectEnd` with `connectionState.isValid === false` and a `toNode` dispatches a `toast` with the `wiringProblem` sentence for the attempted wire (shown near the pointer); the toast clears after 4 seconds. The `EditorActions` provider supplies `onRemoveNode` (`removeNode`, dispatch `edited`), `onRemoveEdge` (`removeEdge`, dispatch `edited`), `onOpenGame` (shows the game view; wired fully in Task 15) and an `onAddFrom(nodeId, port)` that opens `AddMenu` near the card with `addChoices(graph, { node, port })`; the toolbar's "+ Add step" opens it with all choices. Picking a choice runs `addNode`, then `addEdge` from the output to the choice's `wireInto` input when it came from an output, and dispatches one `edited` with the combined graph and touched steps.
- [ ] **Step 4: Guided start.** An empty graph shows a "Start from the starter" button that dispatches `edited` with `starterGraph()`; the hint bar "1. Choose a picture on the first step. 2. Press Play." shows while `hintOpen`.
- [ ] **Step 5: Run `npx tsc --noEmit`, `npm run lint`, `npm test`,** and `npm run build` (the component is not routed yet, so import it from a throwaway check or rely on tsc). Commit `feat: the editor canvas`.

---

### Task 15: Editor part 2: saving, files, Play, game, and the page

**Files:** Modify `web/src/app/graphs/[id]/Editor.tsx`, `page.tsx`, `web/src/app/graphs/page.tsx`, `web/src/lib/graph/edits.ts`, `edits.test.ts`. Delete `web/src/app/graphs/[id]/GraphPlain.tsx`.

- [ ] **Step 1: Autosave.** Create the autosave once (`createAutosave({ delayMs: 800, save })`, disposed on unmount). `save` is `PUT /api/graphs/{id}` with `{ graph }`: 200 is `{ ok: true }`; 401 is `{ ok: false, message: "Your session has expired. Sign in again.", retryable: false }` and shows a banner with a link to `/sign-in` that warns unsaved changes are lost; 400 or 413 returns the server's message, not retryable; a network failure returns "Couldn't reach the server.", retryable. Call `edit(graph)` whenever the graph changes after the first render. Subscribe the toolbar to the state. Add a `beforeunload` warning while the state is `dirty` or `saving`.
- [ ] **Step 2: Choosing a file.** `onChooseFile` checks 4 MB ("<name>: larger than 4 MB"), then `POST /api/graphs/{id}/assets?name=...` with the file as the body; on success dispatch `assets` with the new record added (its `contentType` empty and `uploadedAt` now: the editor never reads them) and `edited` with `editAsset(graph, nodeId, sha256)`; on failure show the server's sentence in the panel.
- [ ] **Step 3: Play.** The button awaits `autosave.flush()` (stop and show the save error if it is `false`), dispatches `play-started`, sets every numbered step pending, `POST /api/graphs/{id}/play`, maps 200 to `{ kind: "ran", ... }` and 422 to `{ kind: "invalid", problems }`, dispatches `play-finished` (or `play-failed` and a toast), then clears the pending set one step at a time by `revealSchedule` (`matchMedia("(prefers-reduced-motion: reduce)")` decides `reducedMotion`). On a successful run set the game view to show the new run (docked: switch to the Game tab). A banner shows "N problems" for an invalid or failed run; clicking it selects the first step with a problem.
- [ ] **Step 4: Game view and theme.** Read `loadPrefs(window.localStorage)` in an effect after mount (guarded by try and catch) and write with `savePrefs` on change; apply `data-theme` to the editor root and `colorMode` to React Flow. Layout: toolbar, hint bar, then the canvas with a right panel holding the two tabs "Settings" (`SettingsPanel`) and "Game" (docked `GamePanel`, which collapses); floating and full render over the canvas. `coarsePointer` is `matchMedia("(pointer: coarse)").matches` read after mount.
- [ ] **Step 5: The page and the list.** `page.tsx` renders `<Editor>` with the record's name, graph, assets and `lastRunId` (keeping the existing sign-in redirect and the uniform 404). Restyle `graphs/page.tsx` to the same tokens and keep "New from starter" and Delete working. Delete `GraphPlain.tsx`; remove `applyToWorkingCopy` and `WorkingCopy` and their tests from `edits.ts` and `edits.test.ts`.
- [ ] **Step 6: Run the full gate** (`npm test`, `npm run lint`, `npm run build`); the build lists `/graphs` and `/graphs/[id]`. Commit `feat: canvas saving, files, Play, game view; the plain page is gone`.

---

### Task 16: Deployed acceptance and wrap-up (needs the deployments)

Blocked on the user's Vercel and Firebase setup (`docs/superpowers/notes/slice2-handoff.md`) and on Task 14 of the 3a plan. Tasks 1 to 15 do not need it.

**Files:** Create `docs/superpowers/notes/slice3b-results.md`. Modify `CLAUDE.md` and a new `docs/superpowers/notes/slice3b-handoff.md`.

- [ ] **Step 1: Deploy the branch** and confirm slice 2's and 3a's own deployed checks first.
- [ ] **Step 2: The seven done-criteria** of the spec, each with its result recorded, in a real browser: (1) starter, picture, Play, colors on the Palette card, play the game; (2) add a 3D Model with the "+", wire it to the hero, play with it; (3) a wrong wire and an occupied input are refused with the sentences; (4) an unplayable tuning shows on the Game Template card, an oversized picture is refused at upload; (5) the three game views and both themes survive a reload; (6) a reload restores the graph, positions and game link; (7) the plain page is gone.
- [ ] **Step 3: The browser-only checks:** dragging, zooming, fit; dropping a wire on a wrong handle; the "+" on an open output; deleting with the keyboard (and not while typing in a field); resizing and dragging the floating window; a laptop-sized window with the panel open; the 150 ms reveal; reduced motion. Fix any bug with a failing unit or render test first where it has a rule in it.
- [ ] **Step 4: Write the results note,** update `CLAUDE.md` and the handoff, then finish the branches with the user per `finishing-a-development-branch` (merge order: slice 1, slice 2, 3a, then this). Commit `docs: slice 3b results`.
