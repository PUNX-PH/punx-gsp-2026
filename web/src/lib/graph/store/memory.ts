// In-memory graph store for tests. It behaves like the real one where it matters: addAsset and update are atomic, and
// every call yields to other callers first so that concurrent requests interleave.
import { type AssetInfo, type Graph, GraphError, type GraphRecord } from "@/lib/graph/types";
import type { GraphFiles, GraphRecords } from "@/lib/graph/store/ports";

const yieldToOthers = () => Promise.resolve();
const notFound = () => new GraphError(404, "Not found");

export class MemoryGraphRecords implements GraphRecords {
  readonly graphs = new Map<string, GraphRecord>();

  private existing(id: string): GraphRecord {
    const record = this.graphs.get(id);
    if (!record) throw notFound();
    return record;
  }

  async create(record: GraphRecord): Promise<void> {
    await yieldToOthers();
    this.graphs.set(record.id, structuredClone(record));
  }

  async get(id: string): Promise<GraphRecord | null> {
    await yieldToOthers();
    const record = this.graphs.get(id);
    return record ? structuredClone(record) : null;
  }

  async listByOwner(uid: string): Promise<GraphRecord[]> {
    await yieldToOthers();
    return [...this.graphs.values()].filter((r) => r.ownerUid === uid).map((r) => structuredClone(r));
  }

  async update(id: string, change: { name?: string; graph?: Graph; removeAssets?: string[]; updatedAt: number }): Promise<GraphRecord> {
    await yieldToOthers();
    // From here to the return nothing yields, so this is atomic like a transaction.
    const record = this.existing(id);
    if (change.name !== undefined) record.name = change.name;
    if (change.graph !== undefined) record.graph = structuredClone(change.graph);
    for (const sha of change.removeAssets ?? []) delete record.assets[sha];
    record.updatedAt = change.updatedAt;
    return structuredClone(record);
  }

  async addAsset(id: string, sha256: string, info: AssetInfo, max: number): Promise<GraphRecord> {
    await yieldToOthers();
    const record = this.existing(id);
    if (!Object.hasOwn(record.assets, sha256)) {
      if (Object.keys(record.assets).length >= max) throw new GraphError(409, `This graph has ${max} files. Remove one first.`);
      record.assets[sha256] = structuredClone(info);
    }
    return structuredClone(record);
  }

  async setLastRunId(id: string, runId: string | null): Promise<void> {
    await yieldToOthers();
    this.existing(id).lastRunId = runId;
  }

  async delete(id: string): Promise<void> {
    await yieldToOthers();
    this.graphs.delete(id);
  }
}

export class MemoryGraphFiles implements GraphFiles {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private key = (graphId: string, sha256: string) => `${graphId}/${sha256}`;

  async put(graphId: string, sha256: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await yieldToOthers();
    this.files.set(this.key(graphId, sha256), { bytes: bytes.slice(), contentType });
  }

  async get(graphId: string, sha256: string): Promise<Uint8Array | null> {
    await yieldToOthers();
    return this.files.get(this.key(graphId, sha256))?.bytes.slice() ?? null;
  }

  async delete(graphId: string, sha256: string): Promise<void> {
    await yieldToOthers();
    this.files.delete(this.key(graphId, sha256));
  }

  async deleteGraph(graphId: string): Promise<void> {
    await yieldToOthers();
    for (const key of [...this.files.keys()]) if (key.startsWith(`${graphId}/`)) this.files.delete(key);
  }
}
