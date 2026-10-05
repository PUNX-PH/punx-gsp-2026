// The builder wired to the real world. It adds nothing of its own to connect (the Blender service it is given holds Firestore and the
// worker); a fresh one is made per request, like the other services, so nothing is read at import time.
import { logOutcome } from "@/lib/ai/server";
import type { BlenderService } from "@/lib/blender/types";
import { makeBuilderService } from "@/lib/builder/service";
import type { BuilderService } from "@/lib/builder/types";

export function getBuilderService(blender: BlenderService): BuilderService {
  return makeBuilderService({ blender, now: Date.now, log: logOutcome });
}
