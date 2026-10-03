import { describe, expect, it } from "vitest";
import { editorReducer, type EditorState, initialEditorState } from "@/lib/canvas/editorState";
import type { NodeOutcome } from "@/lib/graph/runner";
import { addEdge, addNode, editTuning, moveNode, removeEdge, removeNode } from "@/lib/graph/edits";
import { starterGraph } from "@/lib/graph/starter";

const record = (lastRunId: string | null = null) => ({ graph: starterGraph(), assets: {}, lastRunId });
const doneNodes: Record<string, NodeOutcome> = {
  n1: { state: "done" },
  n2: { state: "done" },
  n3: { state: "done" },
  n4: { state: "done", result: { runId: "run9" } },
  n5: { state: "not-used" },
};
const ranDone = { kind: "ran" as const, state: "done" as const, order: ["n1", "n2", "n3", "n4"], nodes: doneNodes, runId: "run9" };

const played = (): EditorState => editorReducer(initialEditorState(record()), { type: "play-finished", response: ranDone });

describe("initialEditorState", () => {
  it("opens the hint only while the graph has never been played", () => {
    expect(initialEditorState(record(null)).hintOpen).toBe(true);
    expect(initialEditorState(record("run1")).hintOpen).toBe(false);
    expect(initialEditorState(record("run1")).run.runId).toBe("run1");
  });

  it("starts with nothing selected, not playing, no toast", () => {
    expect(initialEditorState(record())).toMatchObject({ selection: { kind: "none" }, playing: false, toast: null });
  });
});

describe("editorReducer: edits", () => {
  it("replaces the graph and marks the touched steps and everything downstream stale", () => {
    const edit = removeEdge(starterGraph(), { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } });
    const next = editorReducer(played(), { type: "edited", graph: edit.graph, touched: edit.touched });
    expect(next.graph).toEqual(edit.graph);
    expect(next.run.stale.sort()).toEqual(["n2", "n3", "n4"]);
    expect(Object.keys(next.run.outcomes).sort()).toEqual(["n1", "n5"]);
  });

  it("leaves results alone when a step is only moved", () => {
    const moved = moveNode(starterGraph(), "n1", { x: 5, y: 5 });
    const next = editorReducer(played(), { type: "edited", graph: moved.graph, touched: moved.touched });
    expect(next.run.stale).toEqual([]);
    expect(Object.keys(next.run.outcomes)).toHaveLength(5);
  });

  it("clears a selection whose step or wire no longer exists, and keeps one that does", () => {
    const wire = { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } };
    const selectedNode = editorReducer(played(), { type: "select", selection: { kind: "node", id: "n2" } });
    const selectedEdge = editorReducer(played(), { type: "select", selection: { kind: "edge", edge: wire } });

    const removedNode = removeNode(starterGraph(), "n2");
    expect(editorReducer(selectedNode, { type: "edited", graph: removedNode.graph, touched: removedNode.touched }).selection).toEqual({ kind: "none" });
    expect(editorReducer(selectedEdge, { type: "edited", graph: removedNode.graph, touched: removedNode.touched }).selection).toEqual({ kind: "none" });

    const moved = moveNode(starterGraph(), "n1", { x: 1, y: 1 });
    expect(editorReducer(selectedNode, { type: "edited", graph: moved.graph, touched: [] }).selection).toEqual({ kind: "node", id: "n2" });
    expect(editorReducer(selectedEdge, { type: "edited", graph: moved.graph, touched: [] }).selection).toEqual({ kind: "edge", edge: wire });
  });

  it("forgets a graph-level problem when a step or wire is added or removed, but not when one is moved", () => {
    const invalid = editorReducer(initialEditorState(record()), {
      type: "play-finished",
      response: { kind: "invalid", problems: [{ node: null, message: "Add a Preview node to see your game." }, { node: "n1", message: "Reference Image: choose a picture." }] },
    });
    const moved = moveNode(starterGraph(), "n1", { x: 1, y: 1 });
    expect(editorReducer(invalid, { type: "edited", graph: moved.graph, touched: [] }).run.problems).toHaveLength(2);

    const added = addNode(starterGraph(), "model", { x: 0, y: 400 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(editorReducer(invalid, { type: "edited", graph: added.graph, touched: added.touched }).run.problems).toEqual([
      { node: "n1", message: "Reference Image: choose a picture." },
    ]);

    const wired = addEdge(starterGraph(), { from: { node: "n5", port: "model" }, to: { node: "n3", port: "hero" } });
    expect(wired.ok).toBe(true);
  });

  it("stores uploaded files and selection as given", () => {
    const assets = { abc: { name: "p.png", size: 1, kind: "image" as const, contentType: "", uploadedAt: 0 } };
    expect(editorReducer(initialEditorState(record()), { type: "assets", assets }).assets).toBe(assets);
    expect(editorReducer(initialEditorState(record()), { type: "select", selection: { kind: "node", id: "n1" } }).selection).toEqual({ kind: "node", id: "n1" });
  });
});

describe("editorReducer: Play", () => {
  it("marks playing while a run is on its way", () => {
    expect(editorReducer(initialEditorState(record()), { type: "play-started" }).playing).toBe(true);
  });

  it("applies a finished run, stops playing, and closes the hint after a successful one", () => {
    const started = editorReducer(initialEditorState(record()), { type: "play-started" });
    const finished = editorReducer(started, { type: "play-finished", response: ranDone });
    expect(finished.playing).toBe(false);
    expect(finished.hintOpen).toBe(false);
    expect(finished.run.runId).toBe("run9");
  });

  it("keeps the hint open after a failed or invalid run", () => {
    const failed = editorReducer(initialEditorState(record()), {
      type: "play-finished",
      response: { ...ranDone, state: "failed", runId: undefined, nodes: { ...doneNodes, n3: { state: "failed", error: "x" }, n4: { state: "skipped", because: "y" } } },
    });
    expect(failed.hintOpen).toBe(true);
    const invalid = editorReducer(initialEditorState(record()), { type: "play-finished", response: { kind: "invalid", problems: [] } });
    expect(invalid.hintOpen).toBe(true);
    expect(invalid.playing).toBe(false);
  });

  it("stops playing when the request itself failed, and shows or clears a toast", () => {
    const started = editorReducer(initialEditorState(record()), { type: "play-started" });
    expect(editorReducer(started, { type: "play-failed" }).playing).toBe(false);
    const toasted = editorReducer(started, { type: "toast", message: "Couldn't reach the server." });
    expect(toasted.toast).toBe("Couldn't reach the server.");
    expect(editorReducer(toasted, { type: "toast", message: null }).toast).toBeNull();
  });
});

describe("editorReducer: selection switching (review fix)", () => {
  const wire = { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } };

  it("clears only a selection of its own kind: deselecting a step does not undo selecting a wire", () => {
    const wireSelected = editorReducer(initialEditorState(record()), { type: "select", selection: { kind: "edge", edge: wire } });
    expect(editorReducer(wireSelected, { type: "deselect", kind: "node" }).selection).toEqual({ kind: "edge", edge: wire });
    expect(editorReducer(wireSelected, { type: "deselect", kind: "edge" }).selection).toEqual({ kind: "none" });

    const stepSelected = editorReducer(initialEditorState(record()), { type: "select", selection: { kind: "node", id: "n2" } });
    expect(editorReducer(stepSelected, { type: "deselect", kind: "edge" }).selection).toEqual({ kind: "node", id: "n2" });
    expect(editorReducer(stepSelected, { type: "deselect", kind: "node" }).selection).toEqual({ kind: "none" });
  });

  it("lets a step be selected right after a wire, in either order React Flow reports it", () => {
    let state = initialEditorState(record());
    state = editorReducer(state, { type: "select", selection: { kind: "edge", edge: wire } });
    state = editorReducer(state, { type: "select", selection: { kind: "node", id: "n3" } });
    state = editorReducer(state, { type: "deselect", kind: "edge" }); // the wire's deselect arrives after
    expect(state.selection).toEqual({ kind: "node", id: "n3" });
  });
});

describe("editorReducer: a removed step leaves nothing behind (review fix)", () => {
  it("does not give a new step that reuses an id the old step's results", () => {
    const removed = removeNode(starterGraph(), "n2");
    const afterRemove = editorReducer(played(), { type: "edited", graph: removed.graph, touched: removed.touched });
    const added = addNode(afterRemove.graph, "palette-from-image", { x: 260, y: 0 });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.id).toBe("n2"); // the lowest unused id comes back

    const afterAdd = editorReducer(afterRemove, { type: "edited", graph: added.graph, touched: added.touched });
    expect(afterAdd.run.outcomes.n2).toBeUndefined();
    expect(afterAdd.run.order).not.toContain("n2");
    expect(afterAdd.run.stale).not.toContain("n2");
  });

  it("drops the problem of a removed step, so it is not counted or shown on a step that reuses the id", () => {
    const invalid = editorReducer(initialEditorState(record()), {
      type: "play-finished",
      response: { kind: "invalid", problems: [{ node: "n1", message: "Reference Image: choose a picture." }, { node: "n5", message: "3D Model: choose a model." }] },
    });
    const removed = removeNode(starterGraph(), "n1");
    const after = editorReducer(invalid, { type: "edited", graph: removed.graph, touched: removed.touched });
    expect(after.run.problems).toEqual([{ node: "n5", message: "3D Model: choose a model." }]);
  });
});

describe("editorReducer: edits made while a run is on its way (review fix)", () => {
  it("marks them stale when the run's results arrive, so they are not shown as current", () => {
    let state = editorReducer(initialEditorState(record()), { type: "play-started" });
    const tuned = editTuning(starterGraph(), "n3", { speed: 9, jumpHeight: 3, obstacleSpacing: 20 });
    state = editorReducer(state, { type: "edited", graph: tuned.graph, touched: tuned.touched });

    state = editorReducer(state, { type: "play-finished", response: ranDone });

    expect([...state.run.stale].sort()).toEqual(["n3", "n4"]);
    expect(state.run.outcomes.n3).toBeUndefined();
    expect(state.run.outcomes.n4).toBeUndefined();
    expect(state.run.outcomes.n1).toBeDefined();
  });

  it("forgets what was touched before the next run starts", () => {
    let state = editorReducer(initialEditorState(record()), { type: "play-started" });
    const tuned = editTuning(starterGraph(), "n3", { speed: 9, jumpHeight: 3, obstacleSpacing: 20 });
    state = editorReducer(state, { type: "edited", graph: tuned.graph, touched: tuned.touched });
    state = editorReducer(state, { type: "play-finished", response: ranDone });

    state = editorReducer(state, { type: "play-started" });
    state = editorReducer(state, { type: "play-finished", response: ranDone });
    expect(state.run.stale).toEqual([]);
  });
});
