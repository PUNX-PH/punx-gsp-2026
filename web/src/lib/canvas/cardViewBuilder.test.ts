// What the card of the Build Model step shows: a line of facts, the clips, the summary, what was skipped, and whether it was reused.
import { describe, expect, it } from "vitest";
import { stepData } from "@/lib/canvas/cardView";
import { emptyRunView, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import type { NodeOutcome } from "@/lib/graph/runner";
import type { Graph } from "@/lib/graph/types";

const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
const node = (id: string, type: string, params: Record<string, unknown>) => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });

const graph = (params: Record<string, unknown> = {}): Graph => ({
  schemaVersion: 1,
  nodes: [
    node("n1", "build-model", { role: "hero", kind: "biped", description: "", run: "", jump: "", loop: "", ...params }),
    node("n2", "game-template", { tuning }),
    node("n3", "preview", {}),
  ],
  edges: [wire("n1", "model", "n2", "hero"), wire("n2", "settings", "n3", "settings")],
});

const runWith = (outcomes: Record<string, NodeOutcome>, problems: RunView["problems"] = []): RunView => ({ ...emptyRunView(null), outcomes, problems });
function step(run: RunView = emptyRunView(null), g: Graph = graph()) {
  return stepData({ graph: g, node: g.nodes.find((n) => n.id === "n1")!, assets: {}, run, numbers: stepNumbers(g), graphId: "g1", pending: new Set() });
}

const built = {
  role: "hero",
  kind: "biped",
  parts: 15,
  triangles: 180,
  size: 31_949,
  clips: ["Run", "Jump"],
  summary: "A blocky two-legged character.",
  skipped: [],
  reused: false,
};
const done = (result: unknown) => step(runWith({ n1: { state: "done", result } }));

describe("a Build Model card", () => {
  it("shows the kind, the parts, the triangles and the size on one line, the clips, and the summary", () => {
    expect(done(built).result).toEqual({
      kind: "built",
      line: "Two-legged character, 15 parts, 180 triangles, 31.2 KB",
      clips: "Moves: Run, Jump",
      summary: "A blocky two-legged character.",
      skipped: null,
      reused: false,
    });
  });

  it("names each kind in plain words and groups thousands", () => {
    expect(done({ ...built, kind: "vehicle", parts: 10, triangles: 1_232, clips: ["Loop"] }).result).toMatchObject({
      line: "Wheeled vehicle, 10 parts, 1,232 triangles, 31.2 KB",
      clips: "Moves: Loop",
    });
    expect(done({ ...built, kind: "blob" }).result).toMatchObject({ line: expect.stringMatching(/^Bouncy blob, /) });
    expect(done({ ...built, kind: "prop", parts: 1 }).result).toMatchObject({ line: expect.stringMatching(/^Simple prop, 1 parts?, /) });
  });

  it("says Still when the model has no clips", () => {
    expect(done({ ...built, clips: [] }).result).toMatchObject({ clips: "Still" });
  });

  it("lists what was skipped, with the clip each was asked for", () => {
    const skipped = [
      { clip: "Run", joint: "tail_1" },
      { clip: "Loop", joint: "ear_l" },
    ];
    expect(done({ ...built, skipped }).result).toMatchObject({ skipped: "Skipped, no such part: tail_1 (Run), ear_l (Loop)" });
  });

  it("says when the result was reused", () => {
    expect(done({ ...built, reused: true }).result).toMatchObject({ reused: true });
  });

  it("keeps the summary as plain text, whatever it holds", () => {
    expect(done({ ...built, summary: "<script>alert(1)</script>" }).result).toMatchObject({ summary: "<script>alert(1)</script>" });
  });

  it.each([
    ["a kind that is not one of ours", { ...built, kind: "dragon" }],
    ["parts that are text", { ...built, parts: "15" }],
    ["triangles that are text", { ...built, triangles: "180" }],
    ["a size that is text", { ...built, size: "31" }],
    ["a clip that is not one of ours", { ...built, clips: ["Run", "Dance"] }],
    ["clips that are not a list", { ...built, clips: "Run" }],
    ["a summary that is not text", { ...built, summary: 4 }],
    ["skipped that is not a list", { ...built, skipped: "tail_1" }],
    ["a skipped entry that is not a clip and a joint", { ...built, skipped: [{ clip: "Run" }] }],
    ["no reused flag", { ...built, reused: undefined }],
    ["nothing", undefined],
    ["a string", "built"],
  ])("shows nothing for a result with %s", (_label, result) => {
    expect(done(result).result).toEqual({ kind: "none" });
  });

  it("shows nothing for a failed, skipped or unrun step", () => {
    expect(step().result).toEqual({ kind: "none" });
    const failed = step(runWith({ n1: { state: "failed", error: "Build Model: The Blender service did not answer. Try again." } }));
    expect(failed).toMatchObject({ status: "failed", statusText: "Build Model: The Blender service did not answer. Try again.", result: { kind: "none" } });
    expect(step(runWith({ n1: { state: "skipped", because: "An earlier step failed" } })).result).toEqual({ kind: "none" });
  });

  it("shows the attention status when Auto has no words", () => {
    const card = step(runWith({}, [{ node: "n1", message: "Build Model: describe it first, or pick a kind." }]), graph({ kind: "auto" }));
    expect(card).toMatchObject({ status: "attention", statusText: "Describe it first, or pick a kind." });
  });

  it("lists an optional palette and an optional picture input, and a model output", () => {
    const card = step();
    expect(card.inputs.map((p) => [p.name, p.type, p.required, p.wired])).toEqual([
      ["palette", "palette", false, false],
      ["image", "image", false, false],
    ]);
    expect(card.outputs.map((p) => [p.name, p.type, p.wired])).toEqual([["model", "model", true]]);
  });
});

describe("a Build Environment card", () => {
  const worldGraph = (params: Record<string, unknown> = {}): Graph => ({
    schemaVersion: 1,
    nodes: [node("n1", "build-environment", { theme: "", density: "some", ...params }), node("n2", "game-template", { tuning }), node("n3", "preview", {})],
    edges: [wire("n1", "environment", "n2", "environment"), wire("n2", "settings", "n3", "settings")],
  });
  function stepOf(run: RunView = emptyRunView(null), g: Graph = worldGraph()) {
    return stepData({ graph: g, node: g.nodes[0], assets: {}, run, numbers: stepNumbers(g), graphId: "g1", pending: new Set() });
  }
  const world = { sky: "#1b1f3b", field: "#06d6a0", stripe: "#ffffff", density: "some", scenery: ["tree", "windmill", "rock"], reused: false };
  const doneWorld = (result: unknown) => stepOf(runWith({ n1: { state: "done", result } }));

  it("shows the sky, the field and the stripes as three colors, the scenery by its plain names, and whether it was reused", () => {
    expect(doneWorld(world).result).toEqual({ kind: "environment", colors: ["#1b1f3b", "#06d6a0", "#ffffff"], scenery: "Tree, Windmill, Rock", reused: false });
  });

  it("names each piece in plain words", () => {
    expect(doneWorld({ ...world, scenery: ["pine", "cactus", "lamp"] }).result).toMatchObject({ scenery: "Pine, Cactus, Lamp" });
    expect(doneWorld({ ...world, scenery: ["rock"] }).result).toMatchObject({ scenery: "Rock" });
  });

  it("says No scenery for none, and passes on that the result was reused", () => {
    expect(doneWorld({ ...world, scenery: [] }).result).toMatchObject({ scenery: "No scenery" });
    expect(doneWorld({ ...world, reused: true }).result).toMatchObject({ reused: true });
  });

  it("shows nothing before a run, or after a step that failed or was skipped", () => {
    expect(stepOf().result).toEqual({ kind: "none" });
    expect(stepOf(runWith({ n1: { state: "failed", error: "Build Environment: The Blender service did not answer. Try again." } })).result).toEqual({ kind: "none" });
    expect(stepOf(runWith({ n1: { state: "skipped" } })).result).toEqual({ kind: "none" });
  });

  it.each([
    ["nothing", null],
    ["text", "a meadow"],
    ["a list", []],
    ["no scenery list", { ...world, scenery: undefined }],
    ["a scenery list that is not a list", { ...world, scenery: "tree" }],
    ["a piece that is not in the kit", { ...world, scenery: ["tree", "castle"] }],
    ["a piece that is not text", { ...world, scenery: ["tree", 7] }],
    ["a piece named like a prototype key", { ...world, scenery: ["__proto__"] }],
    ["a piece named like an inherited key", { ...world, scenery: ["constructor"] }],
    ["a sky that is not a color", { ...world, sky: "red" }],
    ["a field that is a number", { ...world, field: 3 }],
    ["a stripe with markup in it", { ...world, stripe: "#ffffff;background:url(x)" }],
    ["a reused that is not true or false", { ...world, reused: "yes" }],
  ])("shows nothing for a result with %s", (_label, result) => {
    expect(doneWorld(result).result).toEqual({ kind: "none" });
  });

  it("lists an optional palette input and an environment output, and is ready to run with an empty theme", () => {
    const card = stepOf();
    expect(card.inputs.map((p) => [p.name, p.type, p.required, p.wired])).toEqual([["palette", "palette", false, false]]);
    expect(card.outputs.map((p) => [p.name, p.type, p.wired])).toEqual([["environment", "environment", true]]);
    expect(card.status).toBe("idle");
  });
});
