import { describe, expect, it } from "vitest";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import type { CachedRecipe } from "@/lib/builder/ports";

const entry = <T>(value: T): CachedRecipe<T> => ({ value, model: "claude-sonnet-5-5", createdAt: 1_700_000_000_000, inputTokens: 4000, outputTokens: 700 });

describe("MemoryRecipeCache", () => {
  it("gives null for a key it has not got", async () => {
    expect(await new MemoryRecipeCache<{ a: number }>().get("missing")).toBeNull();
  });

  it("gives back what was put", async () => {
    const cache = new MemoryRecipeCache<{ a: number }>();
    await cache.put("k", entry({ a: 1 }));
    expect(await cache.get("k")).toEqual(entry({ a: 1 }));
  });

  it("keeps a copy: changing what was put, or what was got, changes nothing stored", async () => {
    const cache = new MemoryRecipeCache<{ tracks: string[] }>();
    const stored = entry({ tracks: ["a"] });
    await cache.put("k", stored);
    stored.value.tracks.push("b");

    const first = await cache.get("k");
    first!.value.tracks.push("c");

    expect((await cache.get("k"))!.value.tracks).toEqual(["a"]);
  });

  it("lets other callers run first, as the real store does", async () => {
    const cache = new MemoryRecipeCache<number>();
    const order: string[] = [];
    const first = cache.put("k", entry(1)).then(() => order.push("put"));
    order.push("sync");
    await first;
    expect(order).toEqual(["sync", "put"]);
  });

  it("with reverseKeys gives every object back with its keys in the other order, at every level, and arrays keep theirs", async () => {
    const cache = new MemoryRecipeCache<{ a: number; b: { x: number; y: number }; list: { p: number; q: number }[] }>({ reverseKeys: true });
    await cache.put("k", entry({ a: 1, b: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }, { p: 3, q: 4 }] }));

    const got = (await cache.get("k"))!;
    expect(got.value).toEqual({ a: 1, b: { x: 1, y: 2 }, list: [{ p: 1, q: 2 }, { p: 3, q: 4 }] }); // equal data
    expect(Object.keys(got.value)).toEqual(["list", "b", "a"]); // other order
    expect(Object.keys(got.value.b)).toEqual(["y", "x"]);
    expect(Object.keys(got.value.list[0])).toEqual(["q", "p"]);
    expect(got.value.list.map((item) => item.p)).toEqual([1, 3]);
    expect(Object.keys(got)).toEqual(["outputTokens", "inputTokens", "createdAt", "model", "value"]);
  });

  it("without reverseKeys leaves the order as it was put", async () => {
    const cache = new MemoryRecipeCache<{ a: number; b: number }>();
    await cache.put("k", entry({ a: 1, b: 2 }));
    expect(Object.keys((await cache.get("k"))!.value)).toEqual(["a", "b"]);
  });
});
