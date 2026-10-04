// The one port the Blender service stores jobs through, so its rules are tested with an in-memory fake: the cache of results
// (Firestore in production, see firebase.ts). The daily limits use the same `UsageLimits` port as Describe Game (lib/ai/ports.ts).

/** A finished job: where its GLB is kept (by SHA-256, in the graph's folder) and what the card shows about it. */
export interface CachedJob {
  sha256: string;
  size: number;
  trianglesBefore: number | null;
  trianglesAfter: number;
  createdAt: number; // milliseconds since the epoch
}

export interface JobCache {
  /** The stored job, or null when this key has none. */
  get(key: string): Promise<CachedJob | null>;
  put(key: string, value: CachedJob): Promise<void>;
}
