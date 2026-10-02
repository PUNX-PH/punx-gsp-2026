// In-memory RunRecords and FileStore for tests. They behave like the real ones where it matters: recordFile is
// atomic, put refuses an existing name, and both yield to other callers so that concurrent requests interleave.
import { type FileMeta, FileExistsError, type FileStore, type Run, RunError, type RunRecords } from "@/lib/runs/types";

const yieldToOthers = () => Promise.resolve();

export class MemoryRunRecords implements RunRecords {
  readonly runs = new Map<string, Run>();

  async create(run: Run): Promise<void> {
    await yieldToOthers();
    this.runs.set(run.id, structuredClone(run));
  }

  async get(id: string): Promise<Run | null> {
    await yieldToOthers();
    const run = this.runs.get(id);
    return run ? structuredClone(run) : null;
  }

  async listByOwner(uid: string): Promise<Run[]> {
    await yieldToOthers();
    return [...this.runs.values()].filter((r) => r.ownerUid === uid).map((r) => structuredClone(r));
  }

  async recordFile(id: string, name: string, meta: FileMeta): Promise<Run> {
    await yieldToOthers();
    // Everything from here to the return runs without yielding, so it is atomic like a transaction.
    const run = this.runs.get(id);
    if (!run) throw new RunError(404, "Not found");
    if (Object.hasOwn(run.files, name)) throw new RunError(409, `${name} was already uploaded`);
    run.files[name] = meta;
    if (run.needed.every((n) => Object.hasOwn(run.files, n))) run.status = "ready";
    return structuredClone(run);
  }

  async delete(id: string): Promise<void> {
    await yieldToOthers();
    this.runs.delete(id);
  }
}

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, { bytes: Uint8Array; contentType: string }>();

  private key = (runId: string, name: string) => `${runId}/${name}`;

  async put(runId: string, name: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await yieldToOthers();
    const key = this.key(runId, name);
    if (this.files.has(key)) throw new FileExistsError(name);
    this.files.set(key, { bytes: bytes.slice(), contentType });
  }

  async get(runId: string, name: string): Promise<Uint8Array | null> {
    await yieldToOthers();
    return this.files.get(this.key(runId, name))?.bytes.slice() ?? null;
  }

  async deleteRun(runId: string): Promise<void> {
    await yieldToOthers();
    for (const key of [...this.files.keys()]) if (key.startsWith(`${runId}/`)) this.files.delete(key);
  }
}
