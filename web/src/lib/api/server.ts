// The APIs wired to the real Firebase auth and the real Firestore and Cloud Storage. Built per request, so nothing
// touches the environment or Firebase at import time.
import { makeApi } from "@/lib/api/handlers";
import { makeSessionApi } from "@/lib/api/sessionHandlers";
import { getAuthPort } from "@/lib/auth/firebaseAdmin";
import { allowedDomain } from "@/lib/auth/server";
import { makeGraphApi } from "@/lib/graph/api";
import { getGraphService } from "@/lib/graph/firebase";
import { getRunService } from "@/lib/runs/firebase";

export const getApi = () => makeApi({ auth: getAuthPort(), runs: getRunService(), domain: allowedDomain() });
export const getGraphApi = () => makeGraphApi({ auth: getAuthPort(), graphs: getGraphService(), domain: allowedDomain() });
export const getSessionApi = () => makeSessionApi({ auth: getAuthPort(), domain: allowedDomain() });
