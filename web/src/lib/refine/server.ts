// The refiner wired to the real world: Claude, and the daily AI limits shared with Describe Game and the builder. Made per request, so nothing is read or
// connected at import time; a missing key only shows when Claude has to be asked.
import { getClaudeClient } from "@/lib/ai/anthropic";
import { FirestoreUsageLimits } from "@/lib/ai/firebase";
import { aiConfigFromEnv, logOutcome } from "@/lib/ai/server";
import { askWith, makeRefineService, type RefineService } from "./service";

export function getRefineService(): RefineService {
  const config = aiConfigFromEnv(process.env);
  return makeRefineService({
    ask: (request) => askWith(getClaudeClient(), config.modelId)(request),
    limits: new FirestoreUsageLimits(),
    perPerson: config.perPerson,
    total: config.total,
    now: Date.now,
    log: logOutcome,
  });
}
