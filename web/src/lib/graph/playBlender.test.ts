// What Play lends the steps for the Blender work: the graph's id, a deadline, a place to keep the files steps make, and the Blender
// service itself (or, with none wired, a plain failure on just those steps).
import { describe, expect, it } from "vitest";
import type { BlenderService } from "@/lib/blender/types";
import { builtinModel } from "@/lib/graph/builtin";
import { EXECUTORS } from "@/lib/graph/nodes";
import { PLAY_BUDGET_MS } from "@/lib/graph/playTime";
import { makeGraphService } from "@/lib/graph/service";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { type Executor, type ExecutorContext, type Graph, type GraphNode } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService, sha256Hex } from "@/lib/runs/service";

const alice = { uid: "alice", email: "alice@punx.ai" };
const NOW = 5_000_000;
const HERO = builtinModel("hero");
const OBSTACLE = builtinModel("obstacle");
const COLLECTIBLE = builtinModel("collectible");

function setup(blender?: BlenderService, executors?: Record<string, Executor>) {
  let graphs = 0;
  const records = new MemoryGraphRecords();
  const files = new MemoryGraphFiles();
  const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: () => NOW, newId: () => "run1" });
  const service = makeGraphService({ records, files, runs, now: () => NOW, newId: () => `g${++graphs}`, blender, executors });
  return { service, records, files, runs };
}

const node = (id: string, type: string, params: Record<string, unknown> = {}): GraphNode => ({ id, type, params, position: { x: 0, y: 0 } });
const wire = (from: string, fromPort: string, to: string, toPort: string) => ({ from: { node: from, port: fromPort }, to: { node: to, port: toPort } });
const tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };

/** A make-shape step feeding a game's collectible, then the preview. */
const shapeGraph = (): Graph => ({
  schemaVersion: 1,
  nodes: [node("n1", "make-shape", { shape: "sphere", color: 4 }), node("n2", "game-template", { tuning }), node("n3", "preview")],
  edges: [wire("n1", "model", "n2", "collectible"), wire("n2", "settings", "n3", "settings")],
});

const model = (sha256: string, size: number) => ({ type: "model" as const, sha256, name: "x.glb", size, format: "glb" as const });

describe("what Play lends a step", () => {
  it("gives the graph's id, a deadline PLAY_BUDGET_MS after Play starts, and a store for the files it makes", async () => {
    const seen: ExecutorContext[] = [];
    let sha = "";
    const maker: Executor = async (_inputs, _params, ctx) => {
      seen.push(ctx);
      sha = await ctx.derived.put(HERO);
      return { output: model(sha, HERO.length), result: {} };
    };
    const { service, files, records, runs } = setup(undefined, { ...EXECUTORS, "make-shape": maker });
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: shapeGraph() });

    const played = await service.play(alice, made.id);

    expect(played.kind).toBe("ran");
    expect(seen).toHaveLength(1);
    expect(seen[0].graphId).toBe(made.id);
    expect(seen[0].deadline).toBe(NOW + PLAY_BUDGET_MS);
    expect(sha).toBe(await sha256Hex(HERO));
    // kept in the graph's own folder as a GLB, but not an upload: it is not in the record's assets
    expect(files.files.get(`${made.id}/${sha}`)).toMatchObject({ contentType: "model/gltf-binary" });
    expect((await records.get(made.id))!.assets).toEqual({});
    // and read back: the game's collectible is that file
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("done");
    expect((await runs.readFile(alice, played.runId!, "collectible.glb")).bytes).toEqual(HERO);
  });

  it("reads a file a step made only once this Play stored or recalled it, and only from the graph's own folder", async () => {
    const checks: Record<string, unknown> = {};
    let storedSha = "";
    let plays = 0;
    const probe: Executor = async (_inputs, _params, ctx) => {
      plays += 1;
      if (plays === 1) {
        storedSha = await ctx.derived.put(HERO);
        checks.before = await ctx.readAsset("0".repeat(64)); // never stored: unreadable
        checks.otherGraph = await ctx.derived.recall(await sha256Hex(OBSTACLE)); // stored in another graph's folder
        checks.otherGraphRead = await ctx.readAsset(await sha256Hex(OBSTACLE));
        checks.badId = await ctx.derived.recall("not-a-sha");
        return { output: model(storedSha, HERO.length), result: {} };
      }
      // a later Play: the file is in the folder but this Play has not recalled it yet
      checks.beforeRecall = await ctx.readAsset(storedSha);
      checks.recalled = await ctx.derived.recall(storedSha);
      checks.afterRecall = await ctx.readAsset(storedSha);
      await ctx.derived.put(COLLECTIBLE);
      return { output: model(storedSha, HERO.length), result: {} };
    };
    const { service, files } = setup(undefined, { ...EXECUTORS, "make-shape": probe });
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: shapeGraph() });
    await files.put("g-other", await sha256Hex(OBSTACLE), OBSTACLE, "model/gltf-binary");

    await service.play(alice, made.id);
    expect(checks).toMatchObject({ before: null, otherGraph: false, otherGraphRead: null, badId: false });

    await service.play(alice, made.id);
    expect(checks.beforeRecall).toBeNull();
    expect(checks.recalled).toBe(true);
    expect(checks.afterRecall).toEqual(HERO);

    // a file that is gone is not recalled
    await files.delete(made.id, storedSha);
    await service.play(alice, made.id);
    expect(checks.recalled).toBe(false);
  });

  it("removes the files steps made when the graph is deleted", async () => {
    const maker: Executor = async (_inputs, _params, ctx) => ({ output: model(await ctx.derived.put(HERO), HERO.length), result: {} });
    const { service, files } = setup(undefined, { ...EXECUTORS, "make-shape": maker });
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: shapeGraph() });
    await service.play(alice, made.id);
    expect([...files.files.keys()].filter((k) => k.startsWith(`${made.id}/`))).toHaveLength(1);

    await service.deleteGraph(alice, made.id);

    expect([...files.files.keys()].filter((k) => k.startsWith(`${made.id}/`))).toHaveLength(0);
  });
});

describe("with no Blender service wired (a deployment without the worker)", () => {
  it("fails just the Blender steps, in plain words, and the rest of the graph is untouched", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    await service.saveGraph(alice, made.id, { graph: shapeGraph() });

    const played = await service.play(alice, made.id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("failed");
    expect(played.result.nodes.n1).toMatchObject({ state: "failed", error: "Make Shape: The Blender service did not answer. Try again." });
    expect(played.result.nodes.n2.state).toBe("skipped");

    const plain = await service.createGraph(alice, { starter: false });
    await service.saveGraph(alice, plain.id, {
      graph: { schemaVersion: 1, nodes: [node("n1", "game-template", { tuning }), node("n2", "preview")], edges: [wire("n1", "settings", "n2", "settings")] },
    });
    expect(await service.play(alice, plain.id)).toMatchObject({ kind: "ran", result: { state: "done" } });
  });

  it("says the same for Prepare Model", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const upload = await service.addAsset(alice, made.id, "hero.glb", HERO);
    const graph: Graph = {
      schemaVersion: 1,
      nodes: [node("n1", "model", { asset: upload.sha256 }), node("n2", "prepare-model", { triangles: 2000, color: "original" }), node("n3", "game-template", { tuning }), node("n4", "preview")],
      edges: [wire("n1", "model", "n2", "model"), wire("n2", "model", "n3", "hero"), wire("n3", "settings", "n4", "settings")],
    };
    await service.saveGraph(alice, made.id, { graph });

    const played = await service.play(alice, made.id);

    if (played.kind !== "ran") throw new Error("did not run");
    expect(played.result.nodes.n2).toMatchObject({ state: "failed", error: "Prepare Model: The Blender service did not answer. Try again." });
  });
});

describe("a game with both Blender steps, with a fake service", () => {
  it("plays: the Preview run holds the prepared hero and the made collectible", async () => {
    const jobs: unknown[] = [];
    const blender: BlenderService = {
      async prepare(job, input) {
        jobs.push({ kind: "prepare", graphId: job.graphId, deadline: job.deadline, format: input.format, triangles: input.triangles, color: input.color, bytes: input.bytes.length });
        const sha256 = await job.derived.put(OBSTACLE);
        return { sha256, size: OBSTACLE.length, trianglesBefore: 500, trianglesAfter: 100, reused: false };
      },
      async shape(job, input) {
        jobs.push({ kind: "shape", graphId: job.graphId, shape: input.shape, color: input.color });
        const sha256 = await job.derived.put(COLLECTIBLE);
        return { sha256, size: COLLECTIBLE.length, trianglesBefore: null, trianglesAfter: 80, reused: false };
      },
      async build() {
        throw new Error("not used");
      },
    };
    const { service, runs } = setup(blender);
    const made = await service.createGraph(alice, {});
    const upload = await service.addAsset(alice, made.id, "robot.glb", HERO);
    const graph: Graph = {
      schemaVersion: 1,
      nodes: [
        node("n1", "model", { asset: upload.sha256 }),
        node("n2", "prepare-model", { triangles: 1500, color: 2 }),
        node("n3", "make-shape", { shape: "coin", color: 3 }),
        node("n4", "game-template", { tuning }),
        node("n5", "preview"),
      ],
      edges: [wire("n1", "model", "n2", "model"), wire("n2", "model", "n4", "hero"), wire("n3", "model", "n4", "collectible"), wire("n4", "settings", "n5", "settings")],
    };
    await service.saveGraph(alice, made.id, { graph });

    const played = await service.play(alice, made.id);

    if (played.kind !== "ran") throw new Error("did not run");
    expect(played.result.state).toBe("done");
    expect(played.result.nodes.n2.result).toMatchObject({ trianglesBefore: 500, trianglesAfter: 100, reused: false });
    expect(jobs).toEqual([
      { kind: "prepare", graphId: made.id, deadline: NOW + PLAY_BUDGET_MS, format: "glb", triangles: 1500, color: "#ff6f59", bytes: HERO.length },
      { kind: "shape", graphId: made.id, shape: "coin", color: "#ffd166" },
    ]);
    expect((await runs.readFile(alice, played.runId!, "hero.glb")).bytes).toEqual(OBSTACLE);
    expect((await runs.readFile(alice, played.runId!, "collectible.glb")).bytes).toEqual(COLLECTIBLE);
    expect((await runs.readFile(alice, played.runId!, "obstacle.glb")).bytes).toEqual(OBSTACLE); // the built-in one: unchanged
  });
});
