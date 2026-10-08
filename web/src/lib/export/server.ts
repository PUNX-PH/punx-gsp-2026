// Export wired to the real world: the packager on Cloud Run (its address and the invoker key from the environment, the same kind of key the Blender
// worker uses), Firestore for the daily download count (`exportUsage`), and the run service the game is stored in. Built per request, so nothing is
// read or connected at import time: the app builds and starts with none of this set, and a missing packager only shows when someone asks for a download.
import type { UsageLimits } from "@/lib/ai/ports";
import { FirestoreUsageLimits } from "@/lib/ai/firebase";
import { logOutcome } from "@/lib/ai/server";
import { makeIdTokenSource } from "@/lib/blender/idToken";
import { dailyLimit } from "@/lib/dailyLimit";
import { makePackager } from "@/lib/export/client";
import { makeExportService } from "@/lib/export/service";
import { type ExportService, type Packager, PackagerNotSetUpError } from "@/lib/export/types";
import type { RunService } from "@/lib/runs/types";

const DEFAULT_PER_PERSON = 20;
const DEFAULT_TOTAL = 200;

function makeRealPackager(): Packager {
  const address = process.env.PACKAGER_URL;
  const key = process.env.PACKAGER_KEY;
  if (!address || !key) throw new PackagerNotSetUpError();
  let origin: string;
  try {
    origin = new URL(address).origin;
    return makePackager({ baseUrl: origin, getIdToken: makeIdTokenSource(key, origin) });
  } catch {
    throw new PackagerNotSetUpError(); // an unreadable address or key: nothing of either is kept
  }
}

/** The service the download uses. The limits can be handed in for a test; in production they are Firestore's. */
export function getExportService(runs: Pick<RunService, "readFile">, limits?: UsageLimits): ExportService {
  return makeExportService({
    runs,
    packager: { pack: async (platform, files) => makeRealPackager().pack(platform, files) },
    limits: limits ?? new FirestoreUsageLimits("exportUsage"),
    perPerson: dailyLimit(process.env.EXPORT_DAILY_LIMIT_PER_PERSON, DEFAULT_PER_PERSON),
    total: dailyLimit(process.env.EXPORT_DAILY_LIMIT_TOTAL, DEFAULT_TOTAL),
    now: Date.now,
    log: logOutcome,
  });
}
