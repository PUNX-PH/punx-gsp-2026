// The builder wired to the real world: Claude for the designs and motions, Firestore for their caches and for the daily AI limits (the
// same `aiUsage` count Describe Game uses), the model and limits from the environment. The Blender service it is given holds Firestore and
// the worker. A fresh one is made per request, like the other services, so nothing is read or connected at import time: the app builds
// and starts with none of this set, and a missing key only shows when Claude has to be asked.
import { getClaudeClient } from "@/lib/ai/anthropic";
import { makeClaudeDesigner } from "@/lib/ai/designer";
import { FirestoreUsageLimits } from "@/lib/ai/firebase";
import type { UsageLimits } from "@/lib/ai/ports";
import { aiConfigFromEnv, logOutcome } from "@/lib/ai/server";
import type { Designer } from "@/lib/ai/types";
import type { BlenderService } from "@/lib/blender/types";
import { FirestoreRecipeCache } from "@/lib/builder/firebase";
import type { RecipeCache } from "@/lib/builder/ports";
import type { EnvironmentDesign, ModelRecipe, MotionRecipe, Skipped } from "@/lib/builder/recipes";
import { makeBuilderService } from "@/lib/builder/service";
import type { BuilderService } from "@/lib/builder/types";

/** The service Play uses. The stores can be handed in for a test; in production they are Firestore's. */
export function getBuilderService(
  blender: BlenderService,
  stores: {
    designs?: RecipeCache<ModelRecipe>;
    motions?: RecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>;
    environments?: RecipeCache<EnvironmentDesign>;
    limits?: UsageLimits;
  } = {},
): BuilderService {
  const config = aiConfigFromEnv(process.env);
  // The Claude client, which needs the key, is only made when Claude has to be asked (a cache hit never needs it). A missing key is the
  // same "did not answer" as any other failure to reach Claude, and gives the person's AI count back.
  const designer: Designer = {
    designModel: (request) => makeClaudeDesigner({ client: getClaudeClient(), model: config.modelId }).designModel(request),
    designMotion: (request) => makeClaudeDesigner({ client: getClaudeClient(), model: config.modelId }).designMotion(request),
    designEnvironment: (request) => makeClaudeDesigner({ client: getClaudeClient(), model: config.modelId }).designEnvironment(request),
  };
  return makeBuilderService({
    blender,
    now: Date.now,
    log: logOutcome,
    ai: {
      designer,
      designs: stores.designs ?? new FirestoreRecipeCache<ModelRecipe>("builderDesigns"),
      motions: stores.motions ?? new FirestoreRecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>("builderMotions"),
      environments: stores.environments ?? new FirestoreRecipeCache<EnvironmentDesign>("builderEnvironments"),
      limits: stores.limits ?? new FirestoreUsageLimits(),
      modelId: config.modelId,
      perPerson: config.perPerson,
      total: config.total,
    },
  });
}
