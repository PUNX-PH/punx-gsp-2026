// The vocabulary of the Describe Game step: what the AI gives back, the service the step calls, the model behind it, and the
// two ways the model can fail. The rules (limits, cache, checking the answer) live in the other files of lib/ai.
import type { User } from "@/lib/auth/ports";
import type { Tuning } from "@/lib/graph/types";

/** What Describe Game gives the graph. The palette is in the template's slot order and already readable; the numbers are playable. */
export interface DescribedGame {
  palette: string[];
  tuning: Tuning;
  /** One plain-text line about the game, at most 140 characters. */
  summary: string;
}

/**
 * What the step calls: it caches, counts, asks the model, checks the answer, and says in plain words when it cannot. A `deadline`
 * (epoch milliseconds, Play's) makes it refuse to start a call that could not finish and shortens the call to fit.
 */
export interface DescribeGameService {
  describe(
    user: User,
    input: { prompt: string; picture: { sha256: string; bytes: Uint8Array } | null; deadline?: number },
  ): Promise<{ answer: DescribedGame; reused: boolean }>;
}

/** The model behind it. `raw` is whatever the model said, parsed as JSON but not trusted; `picture` is already a small JPEG. */
export interface DescribeGameModel {
  ask(request: { prompt: string; picture: Uint8Array | null; timeoutMs?: number }): Promise<{ raw: unknown; usage: { inputTokens: number; outputTokens: number } }>;
}

/** The model declined to answer (its own safety rules). Carries no detail on purpose. */
export class AiRefusedError extends Error {
  constructor() {
    super("The model declined the request");
    this.name = "AiRefusedError";
  }
}

/**
 * The model could not be reached or did not answer in time, or the key is missing or refused. Carries no detail on purpose, except
 * the HTTP status when there was one: a plain number that is safe to log, and what tells a rejected key from an overloaded service.
 */
export class AiUnavailableError extends Error {
  constructor(readonly status?: number) {
    super("The model is not available");
    this.name = "AiUnavailableError";
  }
}
