// The graph service wired to Firestore and Cloud Storage (and to the run service, which Preview stores games in, and to the
// Describe Game service, which asks Claude, and to the Blender service, which asks the worker, and to the builder, which builds
// models on top of that same Blender service).
// Built per request, so nothing touches the environment or Firebase at import time.
import { getDescribeGameService } from "@/lib/ai/server";
import { getBlenderService } from "@/lib/blender/server";
import { getBuilderService } from "@/lib/builder/server";
import { getGameService } from "@/lib/engine/server";
import { type GraphService, makeGraphService } from "@/lib/graph/service";
import { CloudGraphFiles, FirestoreGraphRecords } from "@/lib/graph/store/firebase";
import { getRunService } from "@/lib/runs/firebase";

export function getGraphService(): GraphService {
  const blender = getBlenderService();
  return makeGraphService({
    records: new FirestoreGraphRecords(),
    files: new CloudGraphFiles(),
    runs: getRunService(),
    now: Date.now,
    ai: getDescribeGameService(),
    blender,
    builder: getBuilderService(blender),
    games: getGameService(),
  });
}
