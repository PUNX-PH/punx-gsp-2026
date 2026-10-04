// The catalog entries of the two Blender steps: what they take and give, and which settings are well formed.
import { describe, expect, it } from "vitest";
import { checkGraph } from "@/lib/graph/checks";
import { NODE_SPECS } from "@/lib/graph/registry";
import { parseGraph } from "@/lib/graph/schema";
import type { Graph, GraphNode } from "@/lib/graph/types";

const prepare = NODE_SPECS["prepare-model"];
const makeShape = NODE_SPECS["make-shape"];

describe("Prepare Model", () => {
  it("takes a model (needed) and a palette (optional), gives a model, and starts at 2000 triangles with the model's own colors", () => {
    expect(prepare).toMatchObject({ type: "prepare-model", label: "Prepare Model", help: "Makes a model of yours game-ready: small, in flat colors.", final: false });
    expect(prepare.inputs.map((p) => [p.name, p.type, p.required])).toEqual([["model", "model", true], ["palette", "palette", false]]);
    expect(prepare.inputs[0].missing).toBe("Prepare Model needs a model. Connect a 3D Model.");
    expect(prepare.outputs.map((p) => [p.name, p.type])).toEqual([["model", "model"]]);
    expect(prepare.defaultParams()).toEqual({ triangles: 2000, color: "original" });
    expect(prepare.incompleteProblem({ triangles: 2000, color: "original" })).toBeNull();
  });

  it.each([[100, "original"], [5000, 5], [2000, 1], [2500, 3]])("accepts %s triangles and the color %s", (triangles, color) => {
    expect(prepare.shapeProblem({ triangles, color })).toBeNull();
  });

  it.each([[99], [5001], [2000.5], ["2000"], [null], [undefined], [NaN], [Infinity]])("refuses %s triangles", (triangles) => {
    expect(prepare.shapeProblem({ triangles, color: "original" })).toBe("triangles must be a whole number from 100 to 5000.");
  });

  it.each([[0], [6], [2.5], ["red"], ["Original"], [null], [undefined]])("refuses the color %s", (color) => {
    expect(prepare.shapeProblem({ triangles: 2000, color })).toBe('color must be "original" or a swatch from 1 to 5.');
  });

  it("refuses a missing, an extra or a renamed setting", () => {
    for (const params of [{}, { triangles: 2000 }, { color: "original" }, { triangles: 2000, color: "original", extra: 1 }, { triangle: 2000, color: "original" }]) {
      expect(prepare.shapeProblem(params)).not.toBeNull();
    }
  });
});

describe("Make Shape", () => {
  it("takes an optional palette, gives a model, and starts as a cube in swatch 4", () => {
    expect(makeShape).toMatchObject({ type: "make-shape", label: "Make Shape", help: "Builds a simple low-poly shape.", final: false });
    expect(makeShape.inputs.map((p) => [p.name, p.type, p.required])).toEqual([["palette", "palette", false]]);
    expect(makeShape.outputs.map((p) => [p.name, p.type])).toEqual([["model", "model"]]);
    expect(makeShape.defaultParams()).toEqual({ shape: "cube", color: 4 });
    expect(makeShape.incompleteProblem({ shape: "cube", color: 4 })).toBeNull();
  });

  it.each(["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring"])("accepts the shape %s", (shape) => {
    expect(makeShape.shapeProblem({ shape, color: 1 })).toBeNull();
  });

  it.each([["torus"], ["Cube"], [""], [4], [null], [undefined]])("refuses the shape %s", (shape) => {
    expect(makeShape.shapeProblem({ shape, color: 4 })).toBe("shape must be one of cube, sphere, cone, cylinder, pyramid, coin or ring.");
  });

  it.each([[0], [6], [2.5], ["original"], ["4"], [null], [undefined]])("refuses the color %s", (color) => {
    expect(makeShape.shapeProblem({ shape: "cube", color })).toBe("color must be a swatch from 1 to 5.");
  });

  it("refuses a missing or an extra setting", () => {
    for (const params of [{}, { shape: "cube" }, { color: 4 }, { shape: "cube", color: 4, extra: 1 }]) expect(makeShape.shapeProblem(params)).not.toBeNull();
  });
});

describe("a graph with the Blender steps", () => {
  const node = (id: string, type: string, params: Record<string, unknown>): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } });
  const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
  const graph = (): Graph => ({
    schemaVersion: 1,
    nodes: [
      node("n1", "prepare-model", { triangles: 2000, color: "original" }),
      node("n2", "make-shape", { shape: "coin", color: 2 }),
      node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
      node("n4", "preview", {}),
    ],
    edges: [wire("n1", "model", "n3", "hero"), wire("n2", "model", "n3", "collectible"), wire("n3", "settings", "n4", "settings")],
  });

  it("parses, with a model wire going from either step into a game's role", () => {
    expect(parseGraph(graph())).toEqual({ ok: true, graph: graph() });
  });

  it("stops Play when Prepare Model has no model, with its own sentence", () => {
    expect(checkGraph(graph(), {})).toEqual([{ node: "n1", message: "Prepare Model needs a model. Connect a 3D Model." }]);
  });

  it("refuses to save a bad setting, naming the step", () => {
    const g = graph();
    g.nodes[0].params = { triangles: 50, color: "original" };
    const result = parseGraph(g);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("triangles must be a whole number from 100 to 5000.");
  });
});
