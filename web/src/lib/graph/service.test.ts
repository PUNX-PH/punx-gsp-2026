import { describe, expect, it } from "vitest";
import { checkGlb } from "@/lib/glb";
import { parseGraph } from "@/lib/graph/schema";
import { makeGraphService } from "@/lib/graph/service";
import { describedStarterGraph, starterGraph } from "@/lib/graph/starter";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { type Graph, GraphError } from "@/lib/graph/types";
import { MemoryFileStore, MemoryRunRecords } from "@/lib/runs/memory";
import { makeRunService } from "@/lib/runs/service";
import { makeGlb } from "@/lib/testing/glb";
import { makeJpeg, makePng } from "@/lib/testing/images";

const alice = { uid: "alice", email: "alice@punx.ai" };
const bob = { uid: "bob", email: "bob@punx.ai" };
const MINUTE = 60 * 1000;

function setup() {
  let now = 1_000_000;
  let graphs = 0;
  let runIds = 0;
  const records = new MemoryGraphRecords();
  const files = new MemoryGraphFiles();
  const runRecords = new MemoryRunRecords();
  const runs = makeRunService({ records: runRecords, files: new MemoryFileStore(), now: () => now, newId: () => `run${++runIds}` });
  const service = makeGraphService({ records, files, runs, now: () => now, newId: () => `g${++graphs}` });
  return { service, records, files, runs, runRecords, advance: (ms: number) => void (now += ms), now: () => now };
}

const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);
const glb = () => makeGlb({ asset: { version: "2.0" } });
const withPicture = (sha: string): Graph => {
  const graph = starterGraph();
  graph.nodes[0].params = { asset: sha };
  return graph;
};

describe("creating and listing graphs", () => {
  it("makes the starter graph, or an empty one, owned by the caller", async () => {
    const { service } = setup();
    const starter = await service.createGraph(alice, { starter: true });
    expect(parseGraph(starterGraph()).ok).toBe(true);
    expect(starter).toMatchObject({ id: "g1", ownerUid: "alice", ownerEmail: "alice@punx.ai", name: "Untitled game", assets: {}, lastRunId: null });
    expect(starter.graph).toEqual(starterGraph());
    expect((await service.createGraph(alice, {})).graph).toEqual({ schemaVersion: 1, nodes: [], edges: [] });
  });

  it("trims and shortens a name, and calls an empty one 'Untitled game'", async () => {
    const { service } = setup();
    expect((await service.createGraph(alice, { name: "  My game \u0007 " })).name).toBe("My game");
    expect((await service.createGraph(alice, { name: "x".repeat(200) })).name).toHaveLength(80);
    expect((await service.createGraph(alice, { name: "   " })).name).toBe("Untitled game");
  });

  it("allows 10 graphs a person and says so at the 11th, without affecting anyone else", async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i++) await service.createGraph(alice, {});
    const error = await failure(service.createGraph(alice, {}));
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).status).toBe(409);
    expect((error as GraphError).message).toBe("You have 10 graphs. Delete one first.");
    await service.createGraph(bob, {});
  });

  it("lists only the caller's graphs, the most recently changed first", async () => {
    const { service, advance } = setup();
    const first = await service.createGraph(alice, {});
    advance(1000);
    const second = await service.createGraph(alice, {});
    await service.createGraph(bob, {});
    advance(1000);
    await service.saveGraph(alice, first.id, { name: "touched", graph: first.graph });
    expect((await service.listGraphs(alice)).map((g) => g.id)).toEqual([first.id, second.id]);
  });
});

describe("whose graph it is", () => {
  const operations: [string, (s: ReturnType<typeof setup>["service"], id: string) => Promise<unknown>][] = [
    ["getGraph", (s, id) => s.getGraph(bob, id)],
    ["saveGraph", (s, id) => s.saveGraph(bob, id, { graph: starterGraph() })],
    ["deleteGraph", (s, id) => s.deleteGraph(bob, id)],
    ["addAsset", (s, id) => s.addAsset(bob, id, "a.glb", glb())],
    ["readAsset", (s, id) => s.readAsset(bob, id, "a".repeat(64))],
  ];

  it.each(operations)("%s answers the same 404 for someone else's graph", async (_name, operation) => {
    const { service } = setup();
    const mine = await service.createGraph(alice, {});
    const error = await failure(operation(service, mine.id));
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 404, message: "Not found" });
  });

  it.each(operations)("%s answers the same 404 for a graph that is not there, and for a malformed id", async (_name, operation) => {
    const { service } = setup();
    for (const id of ["nope", "../x", "a/b", "__proto__", ""]) {
      expect(await failure(operation(service, id))).toMatchObject({ status: 404, message: "Not found" });
    }
  });
});

describe("saving a graph", () => {
  it("keeps what is saved, and the name when none is given", async () => {
    const { service, advance } = setup();
    const made = await service.createGraph(alice, { name: "First" });
    advance(5000);
    const saved = await service.saveGraph(alice, made.id, { graph: starterGraph() });
    expect(saved).toMatchObject({ name: "First", graph: starterGraph(), updatedAt: made.updatedAt + 5000 });
    expect((await service.saveGraph(alice, made.id, { name: "Renamed", graph: starterGraph() })).name).toBe("Renamed");
  });

  it("refuses a graph that does not parse, with the parser's own message", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const error = await failure(service.saveGraph(alice, made.id, { graph: { schemaVersion: 2, nodes: [], edges: [] } }));
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 400 });
    expect((error as GraphError).message).toContain("schemaVersion");
  });

  it("refuses a file that was not uploaded to this graph", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const error = await failure(service.saveGraph(alice, made.id, { graph: withPicture("f".repeat(64)) }));
    expect(error).toMatchObject({ status: 400 });
    expect((error as GraphError).message).toContain("Reference Image");
  });

  it("refuses a model where a picture belongs", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const { sha256 } = await service.addAsset(alice, made.id, "hero.glb", glb());
    const error = await failure(service.saveGraph(alice, made.id, { graph: withPicture(sha256) }));
    expect(error).toMatchObject({ status: 400 });
    expect((error as GraphError).message).toMatch(/Reference Image.*not a picture/);
  });

  it("removes files nothing refers to once they are over five minutes old, and keeps the rest", async () => {
    const { service, files, advance } = setup();
    const made = await service.createGraph(alice, {});
    const used = await service.addAsset(alice, made.id, "used.png", await makePng(10, 10, [1, 0, 0]));
    const stale = await service.addAsset(alice, made.id, "stale.png", await makePng(10, 10, [2, 0, 0]));
    advance(6 * MINUTE);
    const fresh = await service.addAsset(alice, made.id, "fresh.png", await makePng(10, 10, [3, 0, 0]));

    const saved = await service.saveGraph(alice, made.id, { graph: withPicture(used.sha256) });

    expect(Object.keys(saved.assets).sort()).toEqual([fresh.sha256, used.sha256].sort());
    expect(await files.get(made.id, stale.sha256)).toBeNull();
    expect(await files.get(made.id, used.sha256)).not.toBeNull();
    expect(await files.get(made.id, fresh.sha256)).not.toBeNull();
  });
});

describe("uploading a file", () => {
  it("accepts a PNG and says what it is", async () => {
    const { service, files, now } = setup();
    const made = await service.createGraph(alice, {});
    const bytes = await makePng(30, 20, [10, 20, 30]);

    const uploaded = await service.addAsset(alice, made.id, "photo.png", bytes);

    expect(uploaded).toMatchObject({ name: "photo.png", size: bytes.length, kind: "image", contentType: "image/png", width: 30, height: 20, uploadedAt: now() });
    expect(uploaded.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await files.get(made.id, uploaded.sha256)).toEqual(bytes);
    expect((await service.getGraph(alice, made.id)).assets[uploaded.sha256].name).toBe("photo.png");
  });

  it("accepts a JPEG and a GLB", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    expect(await service.addAsset(alice, made.id, "p.jpg", await makeJpeg(8, 8, [9, 9, 9]))).toMatchObject({ kind: "image", contentType: "image/jpeg" });
    const model = await service.addAsset(alice, made.id, "hero.glb", glb());
    expect(model).toMatchObject({ kind: "model", contentType: "model/gltf-binary" });
    expect(model.width).toBeUndefined();
  });

  it("decides what a file is from its bytes, never its name", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const error = await failure(service.addAsset(alice, made.id, "photo.png", new TextEncoder().encode("not a picture at all")));
    expect(error).toMatchObject({ status: 400, message: "photo.png: not a PNG, JPEG or GLB file" });
    // a real GLB under a .png name is still a GLB
    expect(await service.addAsset(alice, made.id, "sneaky.png", glb())).toMatchObject({ kind: "model" });
  });

  it("refuses a picture over the pixel limit, and a GLB that is not valid", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    expect(await failure(service.addAsset(alice, made.id, "big.png", await makePng(6000, 5000, [1, 2, 3])))).toMatchObject({ status: 400 });
    const broken = Uint8Array.from([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 1, 0, 0, 0]);
    const expected = checkGlb("hero.glb", broken);
    expect(expected.ok).toBe(false);
    expect(await failure(service.addAsset(alice, made.id, "hero.glb", broken))).toMatchObject({
      status: 400,
      message: expected.ok ? "" : expected.error,
    });
  });

  it("keeps one record, with the first name, for the same bytes uploaded twice (Review Focus 5)", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const bytes = await makePng(10, 10, [5, 5, 5]);
    const first = await service.addAsset(alice, made.id, "first.png", bytes);
    const second = await service.addAsset(alice, made.id, "second.png", bytes);
    expect(second).toEqual(first);
    expect(Object.keys((await service.getGraph(alice, made.id)).assets)).toEqual([first.sha256]);
  });

  it("makes a hostile file name harmless: no control characters, no path separators, at most 100 characters (Review Focus 5)", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const uploaded = await service.addAsset(alice, made.id, "../../x\u0000\\y<script>" + "a".repeat(300), await makePng(10, 10, [6, 6, 6]));
    expect(uploaded.name.length).toBeLessThanOrEqual(100);
    expect(uploaded.name).not.toMatch(/[\u0000-\u001f\u007f/\\]/);
    expect(uploaded.name.length).toBeGreaterThan(0);
  });

  it("holds 20 files a graph; a 21st is refused, unless old unreferenced files can be cleared first (Review Focus 5)", async () => {
    const { service, files, advance } = setup();
    const made = await service.createGraph(alice, {});
    const hashes: string[] = [];
    for (let i = 0; i < 20; i++) hashes.push((await service.addAsset(alice, made.id, `f${i}.png`, await makePng(10, 10, [i, 1, 1]))).sha256);

    const full = await failure(service.addAsset(alice, made.id, "extra.png", await makePng(10, 10, [200, 1, 1])));
    expect(full).toMatchObject({ status: 409, message: "This graph has 20 files. Remove one first." });

    advance(6 * MINUTE);
    const added = await service.addAsset(alice, made.id, "extra.png", await makePng(10, 10, [200, 1, 1]));
    expect(Object.keys((await service.getGraph(alice, made.id)).assets)).toEqual([added.sha256]);
    expect(await files.get(made.id, hashes[0])).toBeNull();
  });
});

describe("reading a file", () => {
  it("returns the bytes and the type, and says 404 for a hash that is not in the graph", async () => {
    const { service } = setup();
    const made = await service.createGraph(alice, {});
    const bytes = await makePng(10, 10, [7, 7, 7]);
    const { sha256 } = await service.addAsset(alice, made.id, "p.png", bytes);

    expect(await service.readAsset(alice, made.id, sha256)).toEqual({ bytes, contentType: "image/png" });
    for (const sha of ["f".repeat(64), "__proto__", "constructor"]) {
      expect(await failure(service.readAsset(alice, made.id, sha))).toMatchObject({ status: 404 });
    }
  });
});

describe("deleting a graph", () => {
  const validSettings = JSON.stringify({
    schemaVersion: 1,
    template: "runner",
    palette: ["#000000", "#111111", "#222222", "#333333", "#444444"],
    roles: { hero: "h.glb", obstacle: "o.glb", collectible: "c.glb" },
    tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 },
  });

  it("removes the record, its files and its last run", async () => {
    const { service, records, files, runs, runRecords } = setup();
    const made = await service.createGraph(alice, {});
    const { sha256 } = await service.addAsset(alice, made.id, "p.png", await makePng(10, 10, [8, 8, 8]));
    const run = await runs.createRun(alice, validSettings);
    await records.setLastRunId(made.id, run.id);

    await service.deleteGraph(alice, made.id);

    expect(await records.get(made.id)).toBeNull();
    expect(await files.get(made.id, sha256)).toBeNull();
    expect(runRecords.runs.size).toBe(0);
  });

  it("works when the last run is already gone", async () => {
    const { service, records } = setup();
    const made = await service.createGraph(alice, {});
    await records.setLastRunId(made.id, "run-that-is-gone");
    await service.deleteGraph(alice, made.id);
    expect(await records.get(made.id)).toBeNull();
  });
});

describe("creating a graph from the Describe a game starter", () => {
  it("stores that graph, and the original starter and the empty graph are unchanged", async () => {
    const { service } = setup();
    expect((await service.createGraph(alice, { starter: "described" })).graph).toEqual(describedStarterGraph());
    expect((await service.createGraph(alice, { starter: true })).graph).toEqual(starterGraph());
    expect((await service.createGraph(alice, { starter: false })).graph).toEqual({ schemaVersion: 1, nodes: [], edges: [] });
  });
});
