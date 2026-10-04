import { afterEach, describe, expect, it, vi } from "vitest";
import { builtinModel } from "@/lib/graph/builtin";
import { sampleImage } from "@/lib/graph/image";
import { makePalette } from "@/lib/graph/palette";
import { makeGraphService } from "@/lib/graph/service";
import { starterGraph } from "@/lib/graph/starter";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { EXECUTORS } from "@/lib/graph/nodes";
import { type DescribedGame, type DescribeGameService } from "@/lib/ai/types";
import { MemoryAnswerCache, MemoryUsageLimits } from "@/lib/ai/memory";
import { makeDescribeGameService } from "@/lib/ai/service";
import { type Executor, GraphError, type Graph, NodeError } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { makeGlb } from "@/lib/testing/glb";
import { makePng } from "@/lib/testing/images";

const alice = { uid: "alice", email: "alice@punx.ai" };
const bob = { uid: "bob", email: "bob@punx.ai" };

function setup() {
  let graphs = 0;
  let runIds = 0;
  const records = new MemoryGraphRecords();
  const runRecords = new MemoryRunRecords();
  const runs = makeRunService({ records: runRecords, files: new MemoryFileStore(), now: Date.now, newId: () => `run${++runIds}` });
  const service = makeGraphService({ records, files: new MemoryGraphFiles(), runs, now: Date.now, newId: () => `g${++graphs}` });
  return { service, records, runs, runRecords };
}

/** A graph from the starter with a picture uploaded and chosen, saved and ready to play. */
async function ready(context: ReturnType<typeof setup>, pictureBytes?: Uint8Array) {
  const { service } = context;
  const made = await service.createGraph(alice, { starter: true });
  const bytes = pictureBytes ?? (await makePng(40, 40, [200, 40, 40]));
  const picture = await service.addAsset(alice, made.id, "p.png", bytes);
  const graph = starterGraph();
  graph.nodes[0].params = { asset: picture.sha256 };
  await service.saveGraph(alice, made.id, { graph });
  return { id: made.id, graph, bytes };
}

const read = async (context: ReturnType<typeof setup>, runId: string, file: string) =>
  (await context.runs.readFile(alice, runId, file)).bytes;

describe("Play", () => {
  it("runs the saved graph and stores a ready run whose palette comes from the picture", async () => {
    const context = setup();
    const { id, bytes } = await ready(context);

    const played = await context.service.play(alice, id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("done");
    expect(played.runId).toBe("run1");
    expect(played.result.nodes.n5).toEqual({ state: "not-used" });
    for (const node of ["n1", "n2", "n3", "n4"]) expect(played.result.nodes[node].state).toBe("done");
    expect(context.runRecords.runs.get("run1")?.status).toBe("ready");

    const sampled = await sampleImage(bytes);
    expect(sampled.ok).toBe(true);
    if (!sampled.ok) return;
    const settings = JSON.parse(new TextDecoder().decode(await read(context, "run1", "settings.json")));
    expect(settings.palette).toEqual(makePalette(sampled.pixels));
    expect((await context.records.get(id))?.lastRunId).toBe("run1");
  });

  it("leaves one run for the graph however often it is played", async () => {
    const context = setup();
    const { id } = await ready(context);
    await context.service.play(alice, id);

    const second = await context.service.play(alice, id);

    expect(second.kind === "ran" && second.runId).toBe("run2");
    expect([...context.runRecords.runs.keys()]).toEqual(["run2"]);
    expect((await context.records.get(id))?.lastRunId).toBe("run2");
  });

  it("says what is missing, and creates nothing, when the graph is not finished", async () => {
    const context = setup();
    const made = await context.service.createGraph(alice, { starter: true });

    const played = await context.service.play(alice, made.id);

    expect(played).toEqual({ kind: "invalid", problems: [{ node: "n1", message: "Reference Image: choose a picture." }] });
    expect(context.runRecords.runs.size).toBe(0);
    expect((await context.records.get(made.id))?.lastRunId).toBeNull();
  });

  it("reports an unplayable tuning on the Game Template, skips the Preview, and keeps the earlier run", async () => {
    const context = setup();
    const { id, graph } = await ready(context);
    await context.service.play(alice, id);
    graph.nodes[2].params = { tuning: { speed: 4, jumpHeight: 2.35, obstacleSpacing: 12 } };
    await context.service.saveGraph(alice, id, { graph });

    const played = await context.service.play(alice, id);

    expect(played.kind).toBe("ran");
    if (played.kind !== "ran") return;
    expect(played.result.state).toBe("failed");
    expect(played.result.nodes.n3.state).toBe("failed");
    expect(played.result.nodes.n3.error).toMatch(/^Game Template: /);
    expect(played.result.nodes.n4.state).toBe("skipped");
    expect(played.runId).toBeUndefined();
    expect([...context.runRecords.runs.keys()]).toEqual(["run1"]);
    expect((await context.records.get(id))?.lastRunId).toBe("run1");
  });

  it("uses a model wired to the hero, and the built-in shapes for the other roles", async () => {
    const context = setup();
    const { id, graph } = await ready(context);
    const hero = makeGlb({ asset: { version: "2.0" }, extras: { mine: true } });
    const uploaded = await context.service.addAsset(alice, id, "mine.glb", hero);
    graph.nodes[4].params = { asset: uploaded.sha256 };
    graph.edges.push({ from: { node: "n5", port: "model" }, to: { node: "n3", port: "hero" } });
    await context.service.saveGraph(alice, id, { graph });

    const played = await context.service.play(alice, id);

    expect(played.kind === "ran" && played.result.state).toBe("done");
    expect(await read(context, "run1", "hero.glb")).toEqual(hero);
    expect(await read(context, "run1", "obstacle.glb")).toEqual(builtinModel("obstacle"));
    expect(await read(context, "run1", "collectible.glb")).toEqual(builtinModel("collectible"));
  });

  it("plays what is saved, not what is being edited", async () => {
    const context = setup();
    const { id, graph } = await ready(context);
    graph.nodes[0].params = { asset: null }; // an edit that was never saved
    const played = await context.service.play(alice, id);
    expect(played.kind).toBe("ran");
  });

  it("answers 404 for someone else's graph", async () => {
    const context = setup();
    const { id } = await ready(context);
    const error = await context.service.play(bob, id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 404, message: "Not found" });
    expect(context.runRecords.runs.size).toBe(0);
  });
});

describe("Play, when a node fails unexpectedly", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the graph, the node and the kind of failure, and never the message", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom: Executor = async () => {
      throw new Error("secret-bytes");
    };
    let graphs = 0;
    let runIds = 0;
    const records = new MemoryGraphRecords();
    const runs = makeRunService({ records: new MemoryRunRecords(), files: new MemoryFileStore(), now: Date.now, newId: () => `run${++runIds}` });
    const service = makeGraphService({
      records,
      files: new MemoryGraphFiles(),
      runs,
      now: Date.now,
      newId: () => `g${++graphs}`,
      executors: { ...EXECUTORS, "palette-from-image": boom },
    });
    const made = await service.createGraph(alice, { starter: true });
    const picture = await service.addAsset(alice, made.id, "p.png", await makePng(20, 20, [9, 9, 9]));
    const graph = starterGraph();
    graph.nodes[0].params = { asset: picture.sha256 };
    await service.saveGraph(alice, made.id, { graph });

    const played = await service.play(alice, made.id);

    expect(played.kind === "ran" && played.result.nodes.n2).toEqual({ state: "failed", error: "Something went wrong on our side" });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged.mock.calls[0][1]).toEqual({ graphId: made.id, node: "n2", type: "palette-from-image", failure: "Error" });
    expect(JSON.stringify(logged.mock.calls)).not.toContain("secret-bytes");
  });
});

describe("Play with a Describe Game step", () => {
  const answer: DescribedGame = {
    palette: ["#101828", "#f97316", "#fde68a", "#34d399", "#f8fafc"],
    tuning: { speed: 7, jumpHeight: 2.6, obstacleSpacing: 18 },
    summary: "A fast neon night run.",
  };

  /** Reference Image -> Describe Game -> Game Template -> Preview, with a picture chosen and a prompt typed. */
  async function describedGame(ai?: DescribeGameService) {
    let graphs = 0;
    let runIds = 0;
    const records = new MemoryGraphRecords();
    const runRecords = new MemoryRunRecords();
    const runs = makeRunService({ records: runRecords, files: new MemoryFileStore(), now: Date.now, newId: () => `run${++runIds}` });
    const service = makeGraphService({ records, files: new MemoryGraphFiles(), runs, now: Date.now, newId: () => `g${++graphs}`, ...(ai ? { ai } : {}) });
    const made = await service.createGraph(alice, {});
    const picture = await service.addAsset(alice, made.id, "p.png", await makePng(40, 40, [200, 40, 40]));
    const node = (id: string, type: string, params: Record<string, unknown>, x: number) => ({ id, type, params, position: { x, y: 0 } });
    const graph: Graph = {
      schemaVersion: 1,
      nodes: [
        node("n1", "reference-image", { asset: picture.sha256 }, 0),
        node("n2", "describe-game", { prompt: "a fast neon night run" }, 260),
        node("n3", "game-template", { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }, 520),
        node("n4", "preview", {}, 780),
      ],
      edges: [
        { from: { node: "n1", port: "image" }, to: { node: "n2", port: "image" } },
        { from: { node: "n2", port: "palette" }, to: { node: "n3", port: "palette" } },
        { from: { node: "n2", port: "feel" }, to: { node: "n3", port: "feel" } },
        { from: { node: "n3", port: "settings" }, to: { node: "n4", port: "settings" } },
      ],
    };
    await service.saveGraph(alice, made.id, { graph });
    return { service, id: made.id, runs, runRecords };
  }

  it("plays to the end, and the stored game has the AI's colors and numbers, not the sliders'", async () => {
    const asked: unknown[] = [];
    const { service, id, runs } = await describedGame({
      async describe(_user, input) {
        asked.push(input);
        return { answer, reused: false };
      },
    });

    const played = await service.play(alice, id);

    expect(played.kind === "ran" && played.result.state).toBe("done");
    const settings = JSON.parse(new TextDecoder().decode((await runs.readFile(alice, "run1", "settings.json")).bytes));
    expect(settings.palette).toEqual(answer.palette);
    expect(settings.tuning).toEqual(answer.tuning);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ prompt: "a fast neon night run", picture: { sha256: expect.stringMatching(/^[0-9a-f]{64}$/) } });
  });

  it("marks Describe Game failed with its sentence and skips what depends on it, leaving no run", async () => {
    const { service, id, runRecords } = await describedGame({
      async describe() {
        throw new NodeError("Describe Game: You have used today's AI answers. Try again tomorrow.");
      },
    });

    const played = await service.play(alice, id);

    expect(played.kind === "ran" && played.result.nodes.n2).toEqual({ state: "failed", error: "Describe Game: You have used today's AI answers. Try again tomorrow." });
    expect(played.kind === "ran" && played.result.nodes.n3.state).toBe("skipped");
    expect(played.kind === "ran" && played.result.nodes.n4.state).toBe("skipped");
    expect(runRecords.runs.size).toBe(0);
  });

  it("asks the model once when the unchanged graph is played twice (with the real service and the fakes)", async () => {
    let asked = 0;
    const ai = makeDescribeGameService({
      cache: new MemoryAnswerCache(),
      limits: new MemoryUsageLimits(),
      model: {
        async ask() {
          asked++;
          return {
            raw: { palette: { background: "#101828", ground: "#f97316", panel: "#fde68a", accent: "#34d399", score: "#f8fafc" }, tuning: answer.tuning, summary: answer.summary },
            usage: { inputTokens: 3000, outputTokens: 300 },
          };
        },
      },
      modelId: "claude-sonnet-5-5",
      perPerson: 30,
      total: 300,
      now: Date.now,
    });
    const { service, id } = await describedGame(ai);

    const first = await service.play(alice, id);
    const second = await service.play(alice, id);

    expect(first.kind === "ran" && first.result.nodes.n2.result).toMatchObject({ reused: false });
    expect(second.kind === "ran" && second.result.nodes.n2.result).toMatchObject({ reused: true });
    expect(asked).toBe(1);
  });

  it("fails that step plainly when no AI service is wired, and still plays graphs that do not use it", async () => {
    const { service, id } = await describedGame();
    const played = await service.play(alice, id);
    expect(played.kind === "ran" && played.result.nodes.n2).toEqual({ state: "failed", error: "Describe Game: The AI service did not answer. Try again." });

    const context = setup(); // the helper above builds a service with no ai at all
    const { id: starterId } = await ready(context);
    const starter = await context.service.play(alice, starterId);
    expect(starter.kind === "ran" && starter.result.state).toBe("done");
  });
});
