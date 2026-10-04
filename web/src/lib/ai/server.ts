// Describe Game wired to the real world: Firestore for the cache and the limits, Claude for the answers, and the settings from the
// environment. Built per request like the other services, so nothing is read or connected at import time: the app builds and
// starts with none of these set, and a missing key only shows when an answer has to be asked for.
import { getClaudeClient, makeClaudeModel } from "@/lib/ai/anthropic";
import { FirestoreAnswerCache, FirestoreUsageLimits } from "@/lib/ai/firebase";
import type { AnswerCache, UsageLimits } from "@/lib/ai/ports";
import { makeDescribeGameService } from "@/lib/ai/service";
import { dailyLimit } from "@/lib/dailyLimit";
import type { DescribeGameModel, DescribeGameService } from "@/lib/ai/types";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_PER_PERSON = 30;
const DEFAULT_TOTAL = 300;

/** The model's name and the two daily limits, from the environment (none of them is a secret). */
export function aiConfigFromEnv(env: Record<string, string | undefined>): { modelId: string; perPerson: number; total: number } {
  return {
    modelId: env.AI_MODEL?.trim() ? env.AI_MODEL.trim() : DEFAULT_MODEL,
    perPerson: dailyLimit(env.AI_DAILY_LIMIT_PER_PERSON, DEFAULT_PER_PERSON),
    total: dailyLimit(env.AI_DAILY_LIMIT_TOTAL, DEFAULT_TOTAL),
  };
}

// Failures are logged as errors, everything else quietly. The service only ever hands this the step, the outcome, token counts
// and (for an unavailable model) a status: never the prompt, the picture, the answer or a message.
const FAILURES = new Set(["unavailable", "unexpected", "bad-answer", "cache-write-failed"]);

export function logOutcome(info: object): void {
  const outcome = (info as { outcome?: unknown }).outcome;
  (typeof outcome === "string" && FAILURES.has(outcome) ? console.error : console.info)("describe game", info);
}

/** The service Play uses. The stores can be handed in for a test; in production they are Firestore's. */
export function getDescribeGameService(stores: { cache?: AnswerCache; limits?: UsageLimits } = {}): DescribeGameService {
  const config = aiConfigFromEnv(process.env);
  // The Claude client, which needs the key, is only made when an answer has to be asked for (a cache hit never needs it).
  const model: DescribeGameModel = {
    ask: (request) => makeClaudeModel({ client: getClaudeClient(), model: config.modelId }).ask(request),
  };
  return makeDescribeGameService({
    cache: stores.cache ?? new FirestoreAnswerCache(),
    limits: stores.limits ?? new FirestoreUsageLimits(),
    model,
    modelId: config.modelId,
    perPerson: config.perPerson,
    total: config.total,
    now: Date.now,
    log: logOutcome,
  });
}
