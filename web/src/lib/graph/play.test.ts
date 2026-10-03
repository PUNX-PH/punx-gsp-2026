import { describe, expect, it } from "vitest";
import { builtinModel } from "@/lib/graph/builtin";
import { sampleImage } from "@/lib/graph/image";
import { makePalette } from "@/lib/graph/palette";
import { makeGraphService } from "@/lib/graph/service";
import { starterGraph } from "@/lib/graph/starter";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { GraphError } from "@/lib/graph/types";
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
