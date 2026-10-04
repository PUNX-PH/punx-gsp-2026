import { describe, expect, it } from "vitest";
import { checkGraph } from "@/lib/graph/checks";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Assets, Graph, GraphNode } from "@/lib/graph/types";
import { ancestors, orderNodes } from "@/lib/graph/walk";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const assets: Assets = { [SHA]: { name: "p.png", size: 1, kind: "image", contentType: "image/png", uploadedAt: 0 } };

const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

/** The starter shape with a picture chosen: n1 picture, n2 palette, n3 template, n4 preview. */
const starter = (): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "reference-image", { asset: SHA }),
    node("n2", "palette-from-image"),
    node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
    node("n4", "preview"),
  ],
  edges: [wire("n1", "image", "n2", "image"), wire("n2", "palette", "n3", "palette"), wire("n3", "settings", "n4", "settings")],
});

/** A bare graph for the walking tests: types and ports do not matter there. */
const bare = (ids: string[], edges: [string, string][]): Graph => ({
  schemaVersion: 1,
  nodes: ids.map((id) => node(id, "x")),
  edges: edges.map(([a, b]) => wire(a, "out", b, "in")),
});

describe("ancestors", () => {
  it("is the roots and everything upstream of them, and nothing else", () => {
    const g = bare(["a", "b", "c", "d", "e"], [["a", "b"], ["b", "c"], ["c", "d"]]); // e is unrelated, d is downstream
    expect([...ancestors(g, ["c"])].sort()).toEqual(["a", "b", "c"]);
    expect([...ancestors(g, ["c", "e"])].sort()).toEqual(["a", "b", "c", "e"]);
  });
});

describe("orderNodes", () => {
  it("orders a chain from its start", () => {
    const g = bare(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    expect(orderNodes(g, new Set(["a", "b", "c"]))).toEqual({ ok: true, order: ["a", "b", "c"] });
  });

  it("takes the lowest id among the nodes that are ready, so the order is always the same", () => {
    const g = bare(["e", "d", "c", "b"], [["d", "e"], ["b", "c"]]);
    expect(orderNodes(g, new Set(["b", "c", "d", "e"]))).toEqual({ ok: true, order: ["b", "c", "d", "e"] });
  });

  it("puts every node after the nodes that feed it", () => {
    const g = bare(["a", "b", "c", "d"], [["a", "b"], ["a", "c"], ["b", "d"], ["c", "d"]]);
    const result = orderNodes(g, new Set(["a", "b", "c", "d"]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const edge of g.edges) expect(result.order.indexOf(edge.from.node)).toBeLessThan(result.order.indexOf(edge.to.node));
  });

  it("ignores wires from nodes outside the set", () => {
    const g = bare(["a", "b", "c"], [["a", "b"], ["b", "c"]]);
    expect(orderNodes(g, new Set(["b", "c"]))).toEqual({ ok: true, order: ["b", "c"] });
  });

  it("names the nodes of a loop, and not the nodes only downstream of it", () => {
    const g = bare(["a", "b", "d"], [["a", "b"], ["b", "a"], ["b", "d"]]);
    expect(orderNodes(g, new Set(["a", "b", "d"]))).toEqual({ ok: false, cycle: ["a", "b"] });
  });
});

describe("checkGraph", () => {
  it("finds nothing wrong with the starter graph once a picture is chosen", () => {
    expect(checkGraph(starter(), assets)).toEqual([]);
  });

  it("asks for a Preview when there is none", () => {
    const g = starter();
    g.nodes = g.nodes.filter((n) => n.id !== "n4");
    g.edges = g.edges.filter((e) => e.to.node !== "n4");
    expect(checkGraph(g, assets)).toEqual([{ node: null, message: "Add a Preview node to see your game." }]);
  });

  it("allows only one Preview", () => {
    const g = starter();
    g.nodes.push(node("n5", "preview"));
    g.edges.push(wire("n3", "settings", "n5", "settings"));
    expect(checkGraph(g, assets)).toEqual([{ node: null, message: "A graph can have only one Preview." }]);
  });

  it("says what a Palette from Image with no picture needs", () => {
    const g = starter();
    g.edges = g.edges.filter((e) => e.to.node !== "n2");
    expect(checkGraph(g, assets)).toEqual([{ node: "n2", message: "Palette from Image needs a picture. Connect a Reference Image." }]);
  });

  it("says what a Preview with no game needs", () => {
    const g = starter();
    g.edges = g.edges.filter((e) => e.to.node !== "n4");
    expect(checkGraph(g, assets)).toEqual([{ node: "n4", message: "Preview needs a game. Connect a Game Template." }]);
  });

  it("asks for a picture to be chosen", () => {
    const g = starter();
    g.nodes[0].params = { asset: null };
    expect(checkGraph(g, assets)).toEqual([{ node: "n1", message: "Reference Image: choose a picture." }]);
  });

  it("asks for a model to be chosen when an unset 3D Model is wired in", () => {
    const g = starter();
    g.nodes.push(node("n5", "model", { asset: null }));
    g.edges.push(wire("n5", "model", "n3", "hero"));
    expect(checkGraph(g, assets)).toEqual([{ node: "n5", message: "3D Model: choose a model." }]);
  });

  it("notices a chosen file that is no longer there", () => {
    const g = starter();
    g.nodes[0].params = { asset: OTHER_SHA };
    expect(checkGraph(g, assets)).toEqual([{ node: "n1", message: "Reference Image: the file is gone. Choose it again." }]);
  });

  it("does not check, or report, nodes that do not lead to the Preview", () => {
    const g = starter();
    g.nodes.push(node("n5", "model", { asset: null })); // unset, but wired to nothing
    expect(checkGraph(g, assets)).toEqual([]);
  });

  it("reports every fault at once", () => {
    const g = starter();
    g.nodes[0].params = { asset: null };
    g.nodes.push(node("n5", "model", { asset: null }), node("n6", "model", { asset: null }));
    g.edges.push(wire("n5", "model", "n3", "hero"), wire("n6", "model", "n3", "obstacle"));
    const problems = checkGraph(g, assets);
    expect(problems).toHaveLength(3);
    expect(problems.map((p) => p.node).sort()).toEqual(["n1", "n5", "n6"]);
  });
});

describe("checkGraph and loops (with made-up node types: today's five cannot loop)", () => {
  const port = (name: string, type: "palette" | "image") => ({ name, label: name, help: name, type, required: false });
  const loopable = (type: string, label: string): NodeSpec => ({
    type,
    label,
    help: label,
    final: false,
    inputs: [port("in", "palette")],
    outputs: [port("out", "palette")],
    defaultParams: () => ({}),
    shapeProblem: () => null,
    incompleteProblem: () => null,
  });
  const specs: Record<string, NodeSpec> = {
    alpha: loopable("alpha", "Alpha"),
    beta: loopable("beta", "Beta"),
    end: { ...NODE_SPECS.preview, type: "end", label: "End", inputs: [{ ...port("in", "palette"), required: true, missing: "End needs an input." }] },
  };

  it("names the steps that loop back on themselves", () => {
    const g: Graph = {
      schemaVersion: 1,
      nodes: [node("b1", "beta"), node("a1", "alpha"), node("e", "end")],
      edges: [wire("a1", "out", "b1", "in"), wire("b1", "out", "a1", "in"), wire("b1", "out", "e", "in")],
    };
    expect(checkGraph(g, {}, specs)).toContainEqual({ node: "a1", message: "These steps loop back on themselves: Alpha, Beta." });
  });
});

describe("checkGraph and Describe Game", () => {
  const described = (prompt: string): Graph => ({
    schemaVersion: 1,
    nodes: [
      node("n1", "reference-image", { asset: SHA }),
      node("n2", "describe-game", { prompt }),
      node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
      node("n4", "preview"),
    ],
    edges: [wire("n1", "image", "n2", "image"), wire("n2", "palette", "n3", "palette"), wire("n2", "feel", "n3", "feel"), wire("n3", "settings", "n4", "settings")],
  });

  it("finds nothing wrong with a prompt that has words in it", () => {
    expect(checkGraph(described("a fast neon night run"), assets)).toEqual([]);
  });

  it.each([["an empty prompt", ""], ["a prompt of only spaces and new lines", "  \n \t "]])("asks for the game to be described: %s", (_label, prompt) => {
    expect(checkGraph(described(prompt), assets)).toEqual([{ node: "n2", message: "Describe Game: describe your game first." }]);
  });

  it("does not need a picture: the input is optional", () => {
    const g = described("a fast neon night run");
    g.nodes = g.nodes.filter((n) => n.id !== "n1");
    g.edges = g.edges.filter((e) => e.from.node !== "n1");
    expect(checkGraph(g, assets)).toEqual([]);
  });
});
