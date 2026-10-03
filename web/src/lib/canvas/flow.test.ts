import type { EdgeChange, NodeChange } from "@xyflow/react";
import { describe, expect, it } from "vitest";
import { connectionToEdge, edgeId, graphFromEdgeChanges, graphFromNodeChanges, toFlow } from "@/lib/canvas/flow";
import { emptyRunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import type { Selection } from "@/lib/canvas/editorState";
import { starterGraph } from "@/lib/graph/starter";

const flow = (selection: Selection = { kind: "none" }) => {
  const graph = starterGraph();
  return toFlow({ graph, assets: {}, run: emptyRunView(null), numbers: stepNumbers(graph), graphId: "g1", pending: new Set(), selection });
};

const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

describe("toFlow", () => {
  it("gives a step node for every step, at its saved position, carrying what its card shows", () => {
    const { nodes } = flow();
    expect(nodes.map((n) => [n.id, n.type, n.position])).toEqual(starterGraph().nodes.map((n) => [n.id, "step", n.position]));
    expect(nodes[1].data).toMatchObject({ id: "n2", label: "Palette from Image", number: 2 });
  });

  it("gives a wire edge for every wire, joined at the port names, with the plain word for what it carries", () => {
    const { edges } = flow();
    expect(edges.map((e) => [e.id, e.type, e.source, e.sourceHandle, e.target, e.targetHandle, e.data.word, e.data.wire])).toEqual([
      ["n1.image->n2.image", "wire", "n1", "image", "n2", "image", "picture", "image"],
      ["n2.palette->n3.palette", "wire", "n2", "palette", "n3", "palette", "palette", "palette"],
      ["n3.settings->n4.settings", "wire", "n3", "settings", "n4", "settings", "game", "settings"],
    ]);
  });

  it("flags the selected step or wire", () => {
    expect(flow({ kind: "node", id: "n2" }).nodes.map((n) => n.selected)).toEqual([false, true, false, false, false]);
    const edges = flow({ kind: "edge", edge: wire("n2", "palette", "n3", "palette") }).edges;
    expect(edges.map((e) => e.selected)).toEqual([false, true, false]);
    expect(flow().nodes.some((n) => n.selected)).toBe(false);
  });

  it("names a wire the same way every time", () => {
    expect(edgeId(wire("n2", "palette", "n3", "palette"))).toBe("n2.palette->n3.palette");
  });
});

describe("connectionToEdge", () => {
  it("turns a finished connection into a wire", () => {
    expect(connectionToEdge({ source: "n1", sourceHandle: "image", target: "n2", targetHandle: "image" })).toEqual(wire("n1", "image", "n2", "image"));
  });

  it("is null for a connection that is not finished (dropped on empty canvas, or no handle)", () => {
    expect(connectionToEdge({ source: "n1", sourceHandle: "image", target: null, targetHandle: null })).toBeNull();
    expect(connectionToEdge({ source: null, sourceHandle: null, target: "n2", targetHandle: "image" })).toBeNull();
    expect(connectionToEdge({ source: "n1", sourceHandle: null, target: "n2", targetHandle: "image" })).toBeNull();
    expect(connectionToEdge({ source: "n1", sourceHandle: "image", target: "n2" })).toBeNull();
  });
});

describe("graphFromNodeChanges", () => {
  const at = (change: NodeChange[]) => graphFromNodeChanges(starterGraph(), change);

  it("moves a step when it is dragged, and touches nothing", () => {
    const result = at([{ id: "n1", type: "position", position: { x: 40, y: 50 }, dragging: true }]);
    expect(result.graph.nodes[0].position).toEqual({ x: 40, y: 50 });
    expect(result.touched).toEqual([]);
  });

  it("deletes a step and its wires and reports the steps it fed", () => {
    const result = at([{ id: "n2", type: "remove" }]);
    expect(result.graph.nodes.map((n) => n.id)).toEqual(["n1", "n3", "n4", "n5"]);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.touched).toEqual(["n3"]);
  });

  it("does not report a step that was deleted in the same batch as touched", () => {
    const result = at([{ id: "n2", type: "remove" }, { id: "n3", type: "remove" }]);
    expect(result.touched).toEqual(["n4"]);
  });

  it("reports which step was selected, and null when the selection was cleared", () => {
    expect(at([{ id: "n1", type: "select", selected: false }, { id: "n3", type: "select", selected: true }]).selected).toBe("n3");
    expect(at([{ id: "n3", type: "select", selected: true }, { id: "n1", type: "select", selected: false }]).selected).toBe("n3");
    expect(at([{ id: "n1", type: "select", selected: false }]).selected).toBeNull();
    expect(at([]).selected).toBeUndefined();
  });

  it("ignores changes that are not edits (sizes)", () => {
    const result = at([{ id: "n1", type: "dimensions", dimensions: { width: 140, height: 90 } }]);
    expect(result.graph).toEqual(starterGraph());
    expect(result.touched).toEqual([]);
  });
});

describe("graphFromEdgeChanges", () => {
  const at = (changes: EdgeChange[]) => graphFromEdgeChanges(starterGraph(), changes);

  it("deletes a wire and touches the step it ended at", () => {
    const result = at([{ id: "n2.palette->n3.palette", type: "remove" }]);
    expect(result.graph.edges).toHaveLength(2);
    expect(result.graph.edges.some((e) => e.to.node === "n3")).toBe(false);
    expect(result.touched).toEqual(["n3"]);
  });

  it("reports the selected wire, and null when it was cleared", () => {
    expect(at([{ id: "n1.image->n2.image", type: "select", selected: true }]).selected).toEqual(wire("n1", "image", "n2", "image"));
    expect(at([{ id: "n1.image->n2.image", type: "select", selected: false }]).selected).toBeNull();
    expect(at([]).selected).toBeUndefined();
  });

  it("ignores a change for a wire that is not there", () => {
    const result = at([{ id: "nope.x->nope.y", type: "remove" }]);
    expect(result.graph).toEqual(starterGraph());
    expect(result.touched).toEqual([]);
  });
});
