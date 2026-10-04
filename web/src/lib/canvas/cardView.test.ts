import { describe, expect, it } from "vitest";
import { formatSize, stepData } from "@/lib/canvas/cardView";
import { applyPlay, emptyRunView, markStale, type RunView } from "@/lib/canvas/runView";
import { stepNumbers } from "@/lib/canvas/stepNumbers";
import { editAsset } from "@/lib/graph/edits";
import type { NodeOutcome } from "@/lib/graph/runner";
import { starterGraph } from "@/lib/graph/starter";
import type { Assets, Graph } from "@/lib/graph/types";

const SHA = "a".repeat(64);
const MODEL_SHA = "b".repeat(64);
const assets: Assets = {
  [SHA]: { name: "photo.png", size: 900, kind: "image", contentType: "image/png", width: 30, height: 20, uploadedAt: 0 },
  [MODEL_SHA]: { name: "hero.glb", size: 1536, kind: "model", contentType: "model/gltf-binary", uploadedAt: 0 },
};

const outcomes: Record<string, NodeOutcome> = {
  n1: { state: "done", result: { name: "photo.png" } },
  n2: { state: "done", result: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"] },
  n3: { state: "done", result: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } } },
  n4: { state: "done", result: { runId: "run2" } },
  n5: { state: "not-used" },
};

function step(id: string, options: { graph?: Graph; run?: RunView; pending?: string[] } = {}) {
  const graph = options.graph ?? starterGraph();
  return stepData({
    graph,
    node: graph.nodes.find((n) => n.id === id)!,
    assets,
    run: options.run ?? emptyRunView(null),
    numbers: stepNumbers(graph),
    graphId: "g1",
    pending: new Set(options.pending ?? []),
  });
}

const playedRun = (): RunView =>
  applyPlay(emptyRunView(null), starterGraph(), { kind: "ran", state: "done", order: ["n1", "n2", "n3", "n4"], nodes: outcomes, runId: "run2" });

describe("formatSize", () => {
  it.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1258291, "1.2 MB"],
  ])("%d bytes is %s", (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe("a step's identity", () => {
  it("carries its plain name, its help, and its order number", () => {
    expect(step("n2")).toMatchObject({ id: "n2", type: "palette-from-image", label: "Palette from Image", help: "Picks five colors from a picture.", number: 2 });
    expect(step("n5").number).toBeNull();
  });

  it("lists its ports with plain labels, whether they are required, and whether they have a wire", () => {
    const template = step("n3");
    expect(template.inputs.map((p) => [p.name, p.label, p.type, p.required, p.wired])).toEqual([
      ["palette", "palette", "palette", false, true],
      ["feel", "feel", "feel", false, false],
      ["hero", "hero model", "model", false, false],
      ["obstacle", "obstacle model", "model", false, false],
      ["collectible", "collectible model", "model", false, false],
    ]);
    expect(template.outputs.map((p) => [p.name, p.type, p.wired])).toEqual([["settings", "settings", true]]);
    expect(step("n2").inputs[0]).toMatchObject({ name: "image", required: true, wired: true });
    expect(step("n5").outputs[0].wired).toBe(false);
  });
});

describe("a step's status", () => {
  it("is 'not used' when it does not lead to a Preview", () => {
    expect(step("n5")).toMatchObject({ status: "not-used", statusText: "Not connected to a Preview" });
  });

  it("is idle, with no text, before anything has happened", () => {
    expect(step("n2")).toMatchObject({ status: "idle", statusText: "" });
  });

  it("is running while it is waiting to be revealed after Play", () => {
    expect(step("n2", { run: playedRun(), pending: ["n2"] })).toMatchObject({ status: "running", statusText: "Running…" });
  });

  it("says done, failed (with its error) or skipped (with why), from the run", () => {
    const run = applyPlay(emptyRunView(null), starterGraph(), {
      kind: "ran",
      state: "failed",
      order: ["n1", "n2", "n3", "n4"],
      nodes: {
        ...outcomes,
        n2: { state: "failed", error: "Palette from Image: the picture is completely transparent" },
        n3: { state: "skipped", because: "Skipped because Palette from Image failed." },
        n4: { state: "skipped", because: "Skipped because Palette from Image failed." },
      },
    });
    expect(step("n1", { run })).toMatchObject({ status: "done", statusText: "Done" });
    expect(step("n2", { run })).toMatchObject({ status: "failed", statusText: "Palette from Image: the picture is completely transparent" });
    expect(step("n3", { run })).toMatchObject({ status: "skipped", statusText: "Skipped because Palette from Image failed." });
  });

  it("needs attention when the graph is not finished: the sentence without its step name, capitalized", () => {
    const run = applyPlay(emptyRunView(null), starterGraph(), {
      kind: "invalid",
      problems: [
        { node: "n1", message: "Reference Image: choose a picture." },
        { node: "n2", message: "Palette from Image needs a picture. Connect a Reference Image." },
      ],
    });
    expect(step("n1", { run })).toMatchObject({ status: "attention", statusText: "Choose a picture." });
    expect(step("n2", { run })).toMatchObject({ status: "attention", statusText: "Palette from Image needs a picture. Connect a Reference Image." });
  });
});

describe("a step's result", () => {
  it("shows a chosen picture before any Play: its name and a thumbnail from the graph's asset route", () => {
    const graph = editAsset(starterGraph(), "n1", SHA).graph;
    expect(step("n1", { graph }).result).toEqual({ kind: "image", name: "photo.png", thumbUrl: `/api/graphs/g1/assets/${SHA}` });
  });

  it("shows a chosen model with its name and size", () => {
    const graph = editAsset(starterGraph(), "n5", MODEL_SHA).graph;
    expect(step("n5", { graph }).result).toEqual({ kind: "model", name: "hero.glb", size: "1.5 KB" });
  });

  it("shows nothing for a file step with nothing chosen, or whose file is gone", () => {
    expect(step("n1").result).toEqual({ kind: "none" });
    const gone = editAsset(starterGraph(), "n1", "f".repeat(64)).graph;
    expect(step("n1", { graph: gone }).result).toEqual({ kind: "none" });
  });

  it("shows the five colors, the tuning, and the way to open the game, from a run", () => {
    const run = playedRun();
    expect(step("n2", { run }).result).toEqual({ kind: "palette", colors: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"] });
    expect(step("n3", { run }).result).toEqual({ kind: "text", text: "speed 6 · jump 2.2 · spacing 12" });
    expect(step("n4", { run }).result).toEqual({ kind: "open-game" });
  });

  it("shows no game link when there is no run to open", () => {
    const run = { ...playedRun(), runId: null };
    expect(step("n4", { run }).result).toEqual({ kind: "none" });
  });

  it("shows the game link for a game made earlier, before anything has run on this page (after a reload)", () => {
    expect(step("n4", { run: emptyRunView("run1") }).result).toEqual({ kind: "open-game" });
  });

  it("does not offer a game link for a Preview that failed or was skipped in the last run", () => {
    const failed = { ...playedRun(), outcomes: { ...outcomes, n4: { state: "failed", error: "x" } } as Record<string, NodeOutcome> };
    const skipped = { ...playedRun(), outcomes: { ...outcomes, n4: { state: "skipped", because: "y" } } as Record<string, NodeOutcome> };
    expect(step("n4", { run: failed }).result).toEqual({ kind: "none" });
    expect(step("n4", { run: skipped }).result).toEqual({ kind: "none" });
  });

  it("holds a result back while its step is still waiting to be revealed", () => {
    expect(step("n2", { run: playedRun(), pending: ["n2"] }).result).toEqual({ kind: "none" });
  });

  it("drops the result of a step an edit made stale, but keeps a chosen file", () => {
    const graph = editAsset(starterGraph(), "n1", SHA).graph;
    const run = markStale(playedRun(), graph, ["n1"]);
    expect(step("n2", { graph, run }).result).toEqual({ kind: "none" });
    expect(step("n1", { graph, run }).result).toMatchObject({ kind: "image", name: "photo.png" });
  });

  it("passes a hostile file name through untouched (escaping is the renderer's job)", () => {
    const hostile = "<script>alert(1)</script>" + "x".repeat(300);
    const named: Assets = { [SHA]: { ...assets[SHA], name: hostile } };
    const graph = editAsset(starterGraph(), "n1", SHA).graph;
    const data = stepData({ graph, node: graph.nodes[0], assets: named, run: emptyRunView(null), numbers: stepNumbers(graph), graphId: "g1", pending: new Set() });
    expect(data.result).toMatchObject({ kind: "image", name: hostile });
  });
});
