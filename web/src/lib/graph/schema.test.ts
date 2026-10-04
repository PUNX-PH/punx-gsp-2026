import { describe, expect, it } from "vitest";
import { NODE_SPECS } from "@/lib/graph/registry";
import { MAX_EDGES, MAX_NODES, parseGraph } from "@/lib/graph/schema";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const SHA = "a".repeat(64);

const valid = (): Json => ({
  schemaVersion: 1,
  nodes: [
    { id: "n1", type: "reference-image", params: { asset: null }, position: { x: 0, y: 0 } },
    { id: "n2", type: "palette-from-image", params: {}, position: { x: 240, y: 0 } },
    { id: "n3", type: "game-template", params: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, position: { x: 480, y: 0 } },
    { id: "n4", type: "preview", params: {}, position: { x: 720, y: 0 } },
  ],
  edges: [
    { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } },
    { from: { node: "n2", port: "palette" }, to: { node: "n3", port: "palette" } },
    { from: { node: "n3", port: "settings" }, to: { node: "n4", port: "settings" } },
  ],
});

const changed = (change: (g: Json) => void): Json => {
  const g = valid();
  change(g);
  return g;
};

function refused(input: unknown) {
  const result = parseGraph(input);
  expect(result.ok).toBe(false);
  return result.ok ? "" : result.error;
}

describe("the node registry", () => {
  it("has the eight node types, with plain names and help on every port", () => {
    expect(Object.keys(NODE_SPECS).sort()).toEqual(["describe-game", "game-template", "make-shape", "model", "palette-from-image", "prepare-model", "preview", "reference-image"]);
    for (const spec of Object.values(NODE_SPECS)) {
      expect(spec.label).not.toBe("");
      expect(spec.help).not.toBe("");
      for (const port of [...spec.inputs, ...spec.outputs]) {
        expect(port.label).not.toBe("");
        expect(port.help).not.toBe("");
      }
      for (const port of spec.inputs.filter((p) => p.required)) expect(port.missing).toBeTruthy();
      expect(spec.shapeProblem(spec.defaultParams())).toBeNull();
    }
    expect(NODE_SPECS["preview"].final).toBe(true);
    expect(Object.values(NODE_SPECS).filter((s) => s.final)).toHaveLength(1);
  });

  it("asks for a file to be chosen only while none is", () => {
    expect(NODE_SPECS["reference-image"].incompleteProblem({ asset: null })).toBe("choose a picture.");
    expect(NODE_SPECS["reference-image"].incompleteProblem({ asset: SHA })).toBeNull();
    expect(NODE_SPECS["model"].incompleteProblem({ asset: null })).toBe("choose a model.");
    expect(NODE_SPECS["preview"].incompleteProblem({})).toBeNull();
  });
});

describe("parseGraph accepts", () => {
  it("a valid graph, unchanged", () => {
    const result = parseGraph(valid());
    expect(result).toEqual({ ok: true, graph: valid() });
  });

  it("a chosen file (a 64-character hash) and an output that feeds two inputs", () => {
    const g = changed((g) => {
      g.nodes[0].params = { asset: SHA };
      g.nodes.push({ id: "n5", type: "palette-from-image", params: {}, position: { x: 240, y: 200 } });
      g.edges.push({ from: { node: "n1", port: "image" }, to: { node: "n5", port: "image" } });
    });
    expect(parseGraph(g).ok).toBe(true);
  });

  it("an empty graph (a half-built graph can always be saved)", () => {
    expect(parseGraph({ schemaVersion: 1, nodes: [], edges: [] }).ok).toBe(true);
  });
});

describe("parseGraph refuses, in plain words", () => {
  it.each([
    ["a number", 5],
    ["null", null],
    ["a list", []],
    ["a string", "graph"],
  ])("%s instead of a graph", (_label, input) => {
    expect(refused(input)).toMatch(/not a JSON object/);
  });

  it.each([
    ["schemaVersion 2", (g: Json) => (g.schemaVersion = 2), /schemaVersion/],
    ["nodes that are not a list", (g: Json) => (g.nodes = {}), /nodes/],
    ["edges that are not a list", (g: Json) => (g.edges = "x"), /wires|edges/],
    [`more than ${MAX_NODES} nodes`, (g: Json) => (g.nodes = Array.from({ length: MAX_NODES + 1 }, (_, i) => ({ id: `x${i}`, type: "model", params: { asset: null }, position: { x: 0, y: 0 } }))), /at most 50 nodes/],
    [`more than ${MAX_EDGES} wires`, (g: Json) => (g.edges = Array.from({ length: MAX_EDGES + 1 }, () => g.edges[0])), /at most 200 wires/],
    ["an empty id", (g: Json) => (g.nodes[0].id = ""), /id/],
    ["an id with a space", (g: Json) => (g.nodes[0].id = "a b"), /id/],
    ["an id of 33 characters", (g: Json) => (g.nodes[0].id = "a".repeat(33)), /id/],
    ["the id __proto__", (g: Json) => (g.nodes[0].id = "__proto__"), /reserved/],
    ["the id constructor", (g: Json) => (g.nodes[0].id = "constructor"), /reserved/],
    ["the id prototype", (g: Json) => (g.nodes[0].id = "prototype"), /reserved/],
    ["two nodes with one id", (g: Json) => (g.nodes[1].id = "n1"), /share the id "n1"/],
    ["an unknown node type", (g: Json) => (g.nodes[0].type = "teleporter"), /unknown node type "teleporter"/],
    ["an unknown key on the graph", (g: Json) => (g.extra = 1), /unknown key "extra"/],
    ["an unknown key on a node", (g: Json) => (g.nodes[0].extra = 1), /unknown key "extra"/],
    ["an unknown key on a wire", (g: Json) => (g.edges[0].extra = 1), /unknown key "extra"/],
    ["a node with no position", (g: Json) => delete g.nodes[0].position, /position/],
    ["a position that is a string", (g: Json) => (g.nodes[0].position = "left"), /position/],
    ["a position that is Infinity", (g: Json) => (g.nodes[0].position = { x: Infinity, y: 0 }), /position/],
    ["a file given as a number", (g: Json) => (g.nodes[0].params = { asset: 5 }), /asset/],
    ["a file that is not a hash", (g: Json) => (g.nodes[0].params = { asset: "xyz" }), /asset/],
    ["settings on a node that takes none", (g: Json) => (g.nodes[1].params = { x: 1 }), /Palette from Image/],
    ["a wire to a node that does not exist", (g: Json) => (g.edges[0].to.node = "zz"), /"zz"/],
    ["a wire to a port that does not exist", (g: Json) => (g.edges[0].to.port = "nope"), /no port "nope"/],
    ["a wire from an input port", (g: Json) => { g.edges[0].from = { node: "n2", port: "image" }; g.edges[0].to = { node: "n3", port: "palette" }; }, /input, not an output/],
    ["a wire to an output port", (g: Json) => (g.edges[0].to = { node: "n2", port: "palette" }), /output, not an input/],
    ["two wires into one input", (g: Json) => {
      g.nodes.push({ id: "n5", type: "reference-image", params: { asset: null }, position: { x: 0, y: 200 } });
      g.edges.push({ from: { node: "n5", port: "image" }, to: { node: "n2", port: "image" } });
    }, /already has a wire/],
    ["the same wire twice", (g: Json) => g.edges.push({ ...g.edges[0] }), /already has a wire/],
  ])("%s", (_label, change, expected) => {
    expect(refused(changed(change as (g: Json) => void))).toMatch(expected as RegExp);
  });

  it("a wire of the wrong type, naming both types in plain words", () => {
    const error = refused(changed((g) => (g.edges[0] = { from: { node: "n1", port: "image" }, to: { node: "n3", port: "palette" } })));
    expect(error).toBe("A picture can't go into a palette input.");
  });

  it("a __proto__ key that came from JSON.parse", () => {
    const parsed = JSON.parse('{"schemaVersion":1,"nodes":[],"edges":[],"__proto__":{"x":1}}');
    expect(refused(parsed)).toMatch(/unknown key "__proto__"/);
  });
});

describe("parseGraph and the tuning of a Game Template (Review Focus 3)", () => {
  const withTuning = (tuning: unknown) => changed((g) => (g.nodes[2].params = { tuning }));

  it.each([
    ["a string", { speed: "6", jumpHeight: 2.2, obstacleSpacing: 12 }],
    ["null", { speed: null, jumpHeight: 2.2, obstacleSpacing: 12 }],
    ["Infinity (what 1e999 parses to)", { speed: Infinity, jumpHeight: 2.2, obstacleSpacing: 12 }],
    ["NaN", { speed: NaN, jumpHeight: 2.2, obstacleSpacing: 12 }],
    ["a missing jumpHeight", { speed: 6, obstacleSpacing: 12 }],
    ["an extra key", { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12, gravity: 9 }],
    ["no tuning object at all", null],
  ])("refuses %s", (_label, tuning) => {
    expect(refused(withTuning(tuning))).toMatch(/Game Template/);
  });

  it("accepts a tuning that is a valid number but not playable (that is decided at Play, with the slice 2 message)", () => {
    expect(parseGraph(withTuning({ speed: 4, jumpHeight: 2.35, obstacleSpacing: 12 })).ok).toBe(true);
  });

  it("reads 1e999 from real JSON as Infinity and refuses it", () => {
    const text = JSON.stringify(valid()).replace('"speed":6', '"speed":1e999');
    expect(refused(JSON.parse(text))).toMatch(/Game Template/);
  });
});

describe("parseGraph and the prompt of a Describe Game", () => {
  const described = (params: unknown): Json => ({ schemaVersion: 1, nodes: [{ id: "n1", type: "describe-game", params, position: { x: 0, y: 0 } }], edges: [] });

  it("accepts a prompt, an empty one (a half-built graph can always be saved), 500 characters, and 500 emoji", () => {
    for (const prompt of ["a fast neon night run", "", "a".repeat(500), "😀".repeat(500)]) {
      expect(parseGraph(described({ prompt })).ok, prompt.slice(0, 10)).toBe(true);
    }
  });

  it("refuses 501 characters, naming the step and the limit", () => {
    expect(refused(described({ prompt: "a".repeat(501) }))).toMatch(/Describe Game.*longer than 500 characters/);
    expect(refused(described({ prompt: "😀".repeat(501) }))).toMatch(/longer than 500 characters/);
  });

  it.each([
    ["a number", { prompt: 5 }],
    ["no prompt", {}],
    ["an extra setting", { prompt: "x", extra: 1 }],
    ["null", { prompt: null }],
  ])("refuses %s", (_label, params) => {
    expect(refused(described(params))).toMatch(/Describe Game/);
  });
});
