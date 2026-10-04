// Blender wired to the real world: Firestore for the cache and the limits, the Cloud Run worker for the jobs, and the settings from
// the environment. Built per request like the other services, so nothing is read or connected at import time: the app builds and
// starts with none of these set, and a missing worker only shows when a job has to be asked for.
import type { UsageLimits } from "@/lib/ai/ports";
import { FirestoreUsageLimits } from "@/lib/ai/firebase";
import { logOutcome } from "@/lib/ai/server";
import { makeBlenderWorker } from "@/lib/blender/client";
import { FirestoreJobCache } from "@/lib/blender/firebase";
import { makeIdTokenSource } from "@/lib/blender/idToken";
import type { JobCache } from "@/lib/blender/ports";
import { makeBlenderService } from "@/lib/blender/service";
import { type BlenderService, BlenderUnavailableError, type BlenderWorker } from "@/lib/blender/types";
import { dailyLimit } from "@/lib/dailyLimit";

const DEFAULT_PER_PERSON = 60;
const DEFAULT_TOTAL = 600;

/** The two daily limits, from the environment (neither is a secret). */
export function blenderConfigFromEnv(env: Record<string, string | undefined>): { perPerson: number; total: number } {
  return {
    perPerson: dailyLimit(env.BLENDER_DAILY_LIMIT_PER_PERSON, DEFAULT_PER_PERSON),
    total: dailyLimit(env.BLENDER_DAILY_LIMIT_TOTAL, DEFAULT_TOTAL),
  };
}

// The worker needs its address and the key, so it is only made when a job has to be asked for (a cache hit never needs it).
function makeWorker(): BlenderWorker {
  const address = process.env.BLENDER_WORKER_URL;
  const key = process.env.BLENDER_WORKER_KEY;
  if (!address || !key) throw new BlenderUnavailableError();
  let origin: string;
  try {
    origin = new URL(address).origin;
  } catch {
    throw new BlenderUnavailableError();
  }
  return makeBlenderWorker({ baseUrl: origin, getIdToken: makeIdTokenSource(key, origin) });
}

/** The service Play uses. The stores can be handed in for a test; in production they are Firestore's. */
export function getBlenderService(stores: { cache?: JobCache; limits?: UsageLimits } = {}): BlenderService {
  const config = blenderConfigFromEnv(process.env);
  const worker: BlenderWorker = {
    prepare: async (input) => makeWorker().prepare(input),
    shape: async (input) => makeWorker().shape(input),
  };
  return makeBlenderService({
    cache: stores.cache ?? new FirestoreJobCache(),
    limits: stores.limits ?? new FirestoreUsageLimits("blenderUsage"),
    worker,
    perPerson: config.perPerson,
    total: config.total,
    now: Date.now,
    log: logOutcome,
  });
}
