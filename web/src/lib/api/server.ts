// The run API wired to the real Firebase auth and the real Firestore and Cloud Storage. Built per request, so
// nothing touches the environment or Firebase at import time.
import { makeApi } from "@/lib/api/handlers";
import { getAuthPort } from "@/lib/auth/firebaseAdmin";
import { allowedDomain } from "@/lib/auth/server";
import { getRunService } from "@/lib/runs/firebase";

export const getApi = () => makeApi({ auth: getAuthPort(), runs: getRunService(), domain: allowedDomain() });
