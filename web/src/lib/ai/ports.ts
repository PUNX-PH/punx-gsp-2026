// The two ports the Describe Game service stores things through, so its rules are tested with in-memory fakes: the cache
// of answers and the daily usage limits (Firestore in production, see firebase.ts).
import type { DescribedGame } from "@/lib/ai/types";

export interface CachedAnswer {
  answer: DescribedGame;
  model: string;
  createdAt: number; // milliseconds since the epoch
  inputTokens: number;
  outputTokens: number;
}

export interface AnswerCache {
  /** The stored answer, or null when this key has none. */
  get(key: string): Promise<CachedAnswer | null>;
  put(key: string, value: CachedAnswer): Promise<void>;
}

export type TakeResult = "ok" | "person-limit" | "site-limit";

export interface UsageLimits {
  /**
   * Counts one new answer for this person and the site on this day, atomically, unless a limit is already reached (then
   * nothing is counted). When both limits are reached it says "person-limit".
   */
  take(uid: string, day: string, limits: { perPerson: number; total: number }): Promise<TakeResult>;
  /** Undoes one `take` for this person and the site, never going below zero. */
  give(uid: string, day: string): Promise<void>;
}
