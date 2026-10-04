import { describe, expect, it } from "vitest";
import { editSettings } from "@/lib/graph/edits";
import type { Graph } from "@/lib/graph/types";

const graph: Graph = {
  schemaVersion: 1,
  nodes: [
    { id: "n1", type: "prepare-model", params: { triangles: 2000, color: "original" }, position: { x: 0, y: 0 } },
    { id: "n2", type: "make-shape", params: { shape: "cube", color: 4 }, position: { x: 0, y: 300 } },
  ],
  edges: [],
};

describe("editSettings", () => {
  it("merges the change into that step's settings, keeping the others", () => {
    const edit = editSettings(graph, "n1", { color: 2 });
    expect(edit.graph.nodes[0].params).toEqual({ triangles: 2000, color: 2 });
    expect(edit.graph.nodes[1].params).toEqual({ shape: "cube", color: 4 });
  });

  it("can change several settings at once", () => {
    expect(editSettings(graph, "n2", { shape: "coin", color: 1 }).graph.nodes[1].params).toEqual({ shape: "coin", color: 1 });
  });

  it("says only that step's results are out of date", () => {
    expect(editSettings(graph, "n1", { triangles: 500 }).touched).toEqual(["n1"]);
  });

  it("leaves the graph it was given alone", () => {
    const before = structuredClone(graph);
    editSettings(graph, "n1", { triangles: 500 });
    expect(graph).toEqual(before);
  });

  it("changes nothing for a step that is not there", () => {
    expect(editSettings(graph, "zz", { color: 2 }).graph).toEqual(graph);
  });
});
