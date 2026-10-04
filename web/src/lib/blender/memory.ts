// An in-memory JobCache, for tests. Like the real one, a stored job is a copy, and every call yields to other callers first so
// that concurrent requests interleave.
import type { CachedJob, JobCache } from "@/lib/blender/ports";

const yieldToOthers = () => Promise.resolve();

export class MemoryJobCache implements JobCache {
  readonly jobs = new Map<string, CachedJob>();

  async get(key: string): Promise<CachedJob | null> {
    await yieldToOthers();
    const found = this.jobs.get(key);
    return found ? structuredClone(found) : null;
  }

  async put(key: string, value: CachedJob): Promise<void> {
    await yieldToOthers();
    this.jobs.set(key, structuredClone(value));
  }
}
