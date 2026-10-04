import { describe, expect, it } from "vitest";
import { MemoryJobCache } from "@/lib/blender/memory";
import type { CachedJob } from "@/lib/blender/ports";

const job: CachedJob = { sha256: "a".repeat(64), size: 1200, trianglesBefore: 9400, trianglesAfter: 2000, createdAt: 5 };

describe("MemoryJobCache", () => {
  it("answers null for a key it has not seen", async () => {
    expect(await new MemoryJobCache().get("nope")).toBeNull();
  });

  it("gives back what was stored, as a copy", async () => {
    const cache = new MemoryJobCache();
    await cache.put("k", job);
    const first = await cache.get("k");
    expect(first).toEqual(job);

    first!.size = 1; // changing what came back does not change what is stored
    expect((await cache.get("k"))!.size).toBe(1200);
  });

  it("keeps a copy of what it was given, too", async () => {
    const cache = new MemoryJobCache();
    const mine = { ...job };
    await cache.put("k", mine);
    mine.size = 7;
    expect((await cache.get("k"))!.size).toBe(1200);
  });

  it("replaces an earlier job under the same key", async () => {
    const cache = new MemoryJobCache();
    await cache.put("k", job);
    await cache.put("k", { ...job, sha256: "b".repeat(64) });
    expect((await cache.get("k"))!.sha256).toBe("b".repeat(64));
  });
});
