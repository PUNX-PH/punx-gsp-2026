// An in-memory RecipeCache, for tests. It behaves like the real one where it matters: every call yields to other callers first so that
// concurrent requests interleave, and an answer is a copy. With `reverseKeys` every object comes back with its keys in the other
// order, as a Firestore round trip may give them: a cache key must not depend on key order.
import type { CachedRecipe, RecipeCache } from "@/lib/builder/ports";

const yieldToOthers = () => Promise.resolve();

/** A deep copy in which every object's keys are in reverse order. Arrays keep their order. */
function reversed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversed);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).reverse().map(([key, member]) => [key, reversed(member)]));
  return value;
}

export class MemoryRecipeCache<T> implements RecipeCache<T> {
  readonly entries = new Map<string, CachedRecipe<T>>();

  constructor(private readonly options: { reverseKeys?: boolean } = {}) {}

  async get(key: string): Promise<CachedRecipe<T> | null> {
    await yieldToOthers();
    const found = this.entries.get(key);
    if (!found) return null;
    return this.options.reverseKeys ? (reversed(found) as CachedRecipe<T>) : structuredClone(found);
  }

  async put(key: string, value: CachedRecipe<T>): Promise<void> {
    await yieldToOthers();
    this.entries.set(key, structuredClone(value));
  }
}
