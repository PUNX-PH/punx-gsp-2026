// The graph service wired to Firestore and Cloud Storage (and to the run service, which Preview stores games in).
// Built per request, so nothing touches the environment or Firebase at import time.
import { type GraphService, makeGraphService } from "@/lib/graph/service";
import { CloudGraphFiles, FirestoreGraphRecords } from "@/lib/graph/store/firebase";
import { getRunService } from "@/lib/runs/firebase";

export function getGraphService(): GraphService {
  return makeGraphService({ records: new FirestoreGraphRecords(), files: new CloudGraphFiles(), runs: getRunService(), now: Date.now });
}
