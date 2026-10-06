// The port the builder stores Claude's checked answers through, so its rules are tested with an in-memory fake (Firestore in
// production, see firebase.ts). One shape serves the model recipes, the motions and the environments.

export interface CachedRecipe<T> {
  /** The answer after repair: what was built, not what Claude first said. */
  value: T;
  model: string;
  createdAt: number; // milliseconds since the epoch
  inputTokens: number;
  outputTokens: number;
}

export interface RecipeCache<T> {
  /** The stored answer, or null when this key has none. */
  get(key: string): Promise<CachedRecipe<T> | null>;
  put(key: string, value: CachedRecipe<T>): Promise<void>;
}
