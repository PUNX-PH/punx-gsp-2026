// The contract every graph store must keep. It runs against the in-memory fakes here; the Firebase adapters are held
// to the same rules by being written to this port, and are first exercised on the deployment.
import { describe, expect, it } from "vitest";
import { MemoryGraphFiles, MemoryGraphRecords } from "@/lib/graph/store/memory";
import { type AssetInfo, type Graph, GraphError, type GraphRecord } from "@/lib/graph/types";

const emptyGraph = (): Graph => ({ schemaVersion: 1, nodes: [], edges: [] });
const info = (name: string): AssetInfo => ({ name, size: 10, kind: "model", contentType: "model/gltf-binary", uploadedAt: 1 });

function record(id: string, ownerUid = "alice", assets: Record<string, AssetInfo> = {}): GraphRecord {
  return { id, ownerUid, ownerEmail: `${ownerUid}@punx.ai`, name: `graph ${id}`, createdAt: 1, updatedAt: 1, graph: emptyGraph(), assets, lastRunId: null };
}

const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("graph records", () => {
  it("stores a record and reads it back, and a missing one is null", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1"));
    expect(await records.get("g1")).toEqual(record("g1"));
    expect(await records.get("nope")).toBeNull();
  });

  it("returns copies, so a caller cannot change what is stored", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1"));
    const read = (await records.get("g1"))!;
    read.name = "changed";
    expect((await records.get("g1"))?.name).toBe("graph g1");
  });

  it("lists only the owner's graphs", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1", "alice"));
    await records.create(record("g2", "bob"));
    await records.create(record("g3", "alice"));
    expect((await records.listByOwner("alice")).map((r) => r.id).sort()).toEqual(["g1", "g3"]);
    expect(await records.listByOwner("carol")).toEqual([]);
  });

  it("updates the name and graph, and removes the listed assets", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1", "alice", { a: info("a.glb"), b: info("b.glb") }));
    const graph: Graph = { schemaVersion: 1, nodes: [{ id: "n1", type: "preview", params: {}, position: { x: 1, y: 2 } }], edges: [] };

    const updated = await records.update("g1", { name: "New", graph, removeAssets: ["a"], updatedAt: 5 });

    expect(updated).toMatchObject({ name: "New", graph, updatedAt: 5 });
    expect(Object.keys(updated.assets)).toEqual(["b"]);
    expect(await records.get("g1")).toEqual(updated);
  });

  it("leaves what it is not given alone", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1", "alice", { a: info("a.glb") }));
    const updated = await records.update("g1", { updatedAt: 9 });
    expect(updated).toMatchObject({ name: "graph g1", updatedAt: 9 });
    expect(Object.keys(updated.assets)).toEqual(["a"]);
  });

  it("refuses to update, or set the run of, a graph that is not there", async () => {
    const records = new MemoryGraphRecords();
    for (const attempt of [records.update("nope", { updatedAt: 1 }), records.setLastRunId("nope", "r1"), records.addAsset("nope", "a", info("a"), 5)]) {
      const error = await failure(attempt);
      expect(error).toBeInstanceOf(GraphError);
      expect((error as GraphError).status).toBe(404);
    }
  });

  it("adds an asset, and the same hash twice leaves one entry, unchanged", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1"));
    const first = await records.addAsset("g1", "a", info("first.glb"), 5);
    const again = await records.addAsset("g1", "a", info("second.glb"), 5);
    expect(Object.keys(first.assets)).toEqual(["a"]);
    expect(again.assets.a.name).toBe("first.glb");
    expect(Object.keys((await records.get("g1"))!.assets)).toEqual(["a"]);
  });

  it("refuses a new asset when the graph already has the most it may", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1", "alice", { a: info("a"), b: info("b") }));
    const error = await failure(records.addAsset("g1", "c", info("c"), 2));
    expect(error).toBeInstanceOf(GraphError);
    expect((error as GraphError).status).toBe(409);
    expect((error as GraphError).message).toBe("This graph has 2 files. Remove one first.");
    // the same hash is still fine at the limit
    expect(Object.keys((await records.addAsset("g1", "a", info("a"), 2)).assets)).toHaveLength(2);
  });

  it("lets exactly one of two simultaneous uploads take the last place", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1", "alice", { a: info("a") }));
    const results = await Promise.allSettled([records.addAsset("g1", "b", info("b"), 2), records.addAsset("g1", "c", info("c"), 2)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(Object.keys((await records.get("g1"))!.assets)).toHaveLength(2);
  });

  it("sets and clears the last run", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1"));
    await records.setLastRunId("g1", "run9");
    expect((await records.get("g1"))?.lastRunId).toBe("run9");
    await records.setLastRunId("g1", null);
    expect((await records.get("g1"))?.lastRunId).toBeNull();
  });

  it("deletes a record, and deleting one that is not there is fine", async () => {
    const records = new MemoryGraphRecords();
    await records.create(record("g1"));
    await records.delete("g1");
    await records.delete("g1");
    expect(await records.get("g1")).toBeNull();
  });
});

describe("graph files", () => {
  const bytes = (...values: number[]) => Uint8Array.from(values);

  it("stores a file and reads it back, and a missing one is null", async () => {
    const files = new MemoryGraphFiles();
    await files.put("g1", "a", bytes(1, 2, 3), "model/gltf-binary");
    expect(await files.get("g1", "a")).toEqual(bytes(1, 2, 3));
    expect(await files.get("g1", "nope")).toBeNull();
    expect(await files.get("g2", "a")).toBeNull();
  });

  it("accepts the same file twice (it is stored under its hash)", async () => {
    const files = new MemoryGraphFiles();
    await files.put("g1", "a", bytes(1), "image/png");
    await files.put("g1", "a", bytes(1), "image/png");
    expect(await files.get("g1", "a")).toEqual(bytes(1));
  });

  it("returns copies, so a caller cannot change what is stored", async () => {
    const files = new MemoryGraphFiles();
    await files.put("g1", "a", bytes(1, 2), "image/png");
    (await files.get("g1", "a"))!.fill(0);
    expect(await files.get("g1", "a")).toEqual(bytes(1, 2));
  });

  it("deletes one file, and all of one graph's files without touching another's", async () => {
    const files = new MemoryGraphFiles();
    await files.put("g1", "a", bytes(1), "image/png");
    await files.put("g1", "b", bytes(2), "image/png");
    await files.put("g2", "a", bytes(3), "image/png");

    await files.delete("g1", "a");
    expect(await files.get("g1", "a")).toBeNull();
    expect(await files.get("g1", "b")).toEqual(bytes(2));

    await files.deleteGraph("g1");
    expect(await files.get("g1", "b")).toBeNull();
    expect(await files.get("g2", "a")).toEqual(bytes(3));
  });
});
