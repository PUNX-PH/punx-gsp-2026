// What the cards of the two Blender steps show, and the swatches their panels offer.
import { describe, expect, it } from "vitest";
import { stepData } from "@/lib/canvas/cardView";
import { emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import type { NodeOutcome } from "@/lib/graph/runner";
import type { Assets, Graph } from "@/lib/graph/types";

const MODEL_SHA = "b".repeat(64);
const assets: Assets = { [MODEL_SHA]: { name: "robot.fbx", size: 4000, kind: "model", format: "fbx", contentType: "application/octet-stream", uploadedAt: 0 } };
const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };

const node = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

/** n1 model, n2 describe game, n3 prepare model (fed by both), n4 make shape (fed by the describe step), n5 template, n6 preview. */
const graph = (): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "model", { asset: MODEL_SHA }),
    node("n2", "describe-game", { prompt: "a run" }),
    node("n3", "prepare-model", { triangles: 2000, color: 2 }),
    node("n4", "make-shape", { shape: "sphere", color: 4 }),
    node("n5", "game-template", { tuning }),
    node("n6", "preview", {}),
  ],
  edges: [
    wire("n1", "model", "n3", "model"),
    wire("n2", "palette", "n3", "palette"),
    wire("n2", "palette", "n4", "palette"),
    wire("n3", "model", "n5", "hero"),
    wire("n4", "model", "n5", "collectible"),
    wire("n5", "settings", "n6", "settings"),
  ],
});

const runWith = (outcomes: Record<string, NodeOutcome>): RunView => ({ ...emptyRunView(null), outcomes });
function step(id: string, run: RunView = emptyRunView(null), g: Graph = graph()) {
  return stepData({ graph: g, node: g.nodes.find((n) => n.id === id)!, assets, run, numbers: stepNumbers(g), graphId: "g1", pending: new Set() });
}

const prepared = { trianglesBefore: 9400, trianglesAfter: 2000, size: 41_984, color: "#ff6f59", reused: false };
const made = { shape: "sphere", color: "#06d6a0", trianglesAfter: 80, size: 3_072, reused: true };
const prepareDone = (result: unknown) => step("n3", runWith({ n3: { state: "done", result } }));
const shapeDone = (result: unknown) => step("n4", runWith({ n4: { state: "done", result } }));

describe("a Prepare Model card", () => {
  it("says what changed in plain facts, with the color it was painted", () => {
    expect(prepareDone(prepared).result).toEqual({ kind: "made", line: "9,400 triangles to 2,000, 41.0 KB, flat #ff6f59", swatch: "#ff6f59", reused: false });
  });

  it("says the model kept its own colors when it was not painted", () => {
    expect(prepareDone({ ...prepared, color: null }).result).toEqual({ kind: "made", line: "9,400 triangles to 2,000, 41.0 KB, original colors", swatch: null, reused: false });
  });

  it("leaves out the 'from' when the worker did not say, and when nothing was removed", () => {
    expect(prepareDone({ ...prepared, trianglesBefore: null }).result).toMatchObject({ line: "2,000 triangles, 41.0 KB, flat #ff6f59" });
    expect(prepareDone({ ...prepared, trianglesBefore: 2000 }).result).toMatchObject({ line: "2,000 triangles, 41.0 KB, flat #ff6f59" });
  });

  it("says when the result was reused", () => {
    expect(prepareDone({ ...prepared, reused: true }).result).toMatchObject({ reused: true });
  });

  it.each([
    ["no numbers", { ...prepared, trianglesAfter: undefined }],
    ["numbers that are text", { ...prepared, trianglesAfter: "2000" }],
    ["a before-count that is text", { ...prepared, trianglesBefore: "9400" }],
    ["a size that is text", { ...prepared, size: "41" }],
    ["a color that is not a #rrggbb color", { ...prepared, color: "red;background:url(x)" }],
    ["no reused flag", { ...prepared, reused: undefined }],
    ["nothing", undefined],
  ])("shows nothing for a result with %s", (_label, result) => {
    expect(prepareDone(result).result).toEqual({ kind: "none" });
  });

  it("shows nothing before a run, and the failure's sentence after a failure", () => {
    expect(step("n3").result).toEqual({ kind: "none" });
    const failed = step("n3", runWith({ n3: { state: "failed", error: "Prepare Model: This file has no 3D shape in it." } }));
    expect(failed).toMatchObject({ status: "failed", statusText: "Prepare Model: This file has no 3D shape in it.", result: { kind: "none" } });
  });

  it("lists a needed model input and an optional palette input, and a model output", () => {
    const card = step("n3");
    expect(card.inputs.map((p) => [p.name, p.type, p.required, p.wired])).toEqual([["model", "model", true, true], ["palette", "palette", false, true]]);
    expect(card.outputs.map((p) => [p.name, p.type, p.wired])).toEqual([["model", "model", true]]);
  });
});

describe("a Make Shape card", () => {
  it("shows the shape, its triangles and size, with the color", () => {
    expect(shapeDone(made).result).toEqual({ kind: "made", line: "Sphere, 80 triangles, 3.0 KB", swatch: "#06d6a0", reused: true });
  });

  it.each([
    ["a shape that is not one of ours", { ...made, shape: "torus" }],
    ["a color that is not a #rrggbb color", { ...made, color: "javascript:alert(1)" }],
    ["no color", { ...made, color: null }],
    ["numbers that are text", { ...made, trianglesAfter: "80" }],
    ["nothing", undefined],
  ])("shows nothing for a result with %s", (_label, result) => {
    expect(shapeDone(result).result).toEqual({ kind: "none" });
  });
});

describe("the swatches a Blender step offers", () => {
  const palette = ["#101828", "#f97316", "#fde68a", "#34d399", "#f8fafc"];
  const described: NodeOutcome = { state: "done", result: { palette, tuning, summary: "x", reused: false } };

  it("are the colors of the palette wired in, once the step that makes it has run", () => {
    expect(step("n3", runWith({ n2: described })).swatches).toEqual(palette);
    expect(step("n4", runWith({ n2: described })).swatches).toEqual(palette);
  });

  it("are the colors a Palette from Image step made", () => {
    const g = graph();
    g.nodes[1] = node("n2", "palette-from-image", {});
    g.edges[0] = wire("n1", "model", "n3", "model");
    expect(step("n3", runWith({ n2: { state: "done", result: palette } }), g).swatches).toEqual(palette);
  });

  it("are the sample palette before that step has run, or when it failed", () => {
    expect(step("n3").swatches).toEqual([...SAMPLE_PALETTE]);
    expect(step("n3", runWith({ n2: { state: "failed", error: "x" } })).swatches).toEqual([...SAMPLE_PALETTE]);
  });

  it("are the sample palette when no palette is wired in", () => {
    const g = graph();
    g.edges = g.edges.filter((e) => !(e.to.node === "n4" && e.to.port === "palette"));
    expect(step("n4", runWith({ n2: described }), g).swatches).toEqual([...SAMPLE_PALETTE]);
  });

  it.each([
    ["too few colors", ["#101828", "#f97316"]],
    ["a color that is not #rrggbb", ["#101828", "#f97316", "red", "#34d399", "#f8fafc"]],
    ["colors that are not text", [1, 2, 3, 4, 5]],
    ["not a list", "red"],
  ])("are the sample palette when the result has %s", (_label, bad) => {
    expect(step("n3", runWith({ n2: { state: "done", result: { palette: bad } } })).swatches).toEqual([...SAMPLE_PALETTE]);
  });

  it("belong to the two Blender steps only", () => {
    for (const id of ["n1", "n2", "n5", "n6"]) expect(step(id, runWith({ n2: described })).swatches).toBeUndefined();
  });
});
