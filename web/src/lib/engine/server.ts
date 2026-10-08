// The game service wired to the real world: Claude for the games, Firestore for their cache (collection `gameSpecs`) and for the daily AI limits (the
// same `aiUsage` count Describe Game and the builder use), the model and limits from the environment. A fresh one is made per request, like the
// other services, so nothing is read or connected at import time: the app builds and starts with none of this set, and a missing key only shows when
// Claude has to be asked.
import { getClaudeClient } from "@/lib/ai/anthropic";
import { FirestoreUsageLimits } from "@/lib/ai/firebase";
import type { UsageLimits } from "@/lib/ai/ports";
import { aiConfigFromEnv, logOutcome } from "@/lib/ai/server";
import { FirestoreRecipeCache } from "@/lib/builder/firebase";
import type { RecipeCache } from "@/lib/builder/ports";
import { makeClaudeGameAuthor, type GameAuthor } from "./author";
import { makeGameService, type CachedGame, type GameService } from "./service";

/** The service Play uses. The stores can be handed in for a test; in production they are Firestore's. */
export function getGameService(stores: { cache?: RecipeCache<CachedGame>; limits?: UsageLimits } = {}): GameService {
  const config = aiConfigFromEnv(process.env);
  // The Claude client, which needs the key, is only made when Claude has to be asked (a cache hit never needs it). A missing key is the same
  // "did not answer" as any other failure to reach Claude, and gives the person's AI count back.
  const author: GameAuthor = {
    author: (request) => makeClaudeGameAuthor({ client: getClaudeClient(), model: config.modelId }).author(request),
  };
  return makeGameService({
    author,
    cache: stores.cache ?? new FirestoreRecipeCache<CachedGame>("gameSpecs"),
    limits: stores.limits ?? new FirestoreUsageLimits(),
    modelId: config.modelId,
    perPerson: config.perPerson,
    total: config.total,
    now: Date.now,
    log: logOutcome,
  });
}
