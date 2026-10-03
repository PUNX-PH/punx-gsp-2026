import { describe, expect, it } from "vitest";
import { editorReducer, type EditorState, initialEditorState } from "@/lib/canvas/editorState";
import type { NodeOutcome } from "@/lib/graph/runner";
import { addEdge, addNode, moveNode, removeEdge, removeNode } from "@/lib/graph/edits";
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
