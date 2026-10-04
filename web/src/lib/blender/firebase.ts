// The real JobCache (Firestore), through the Admin SDK, which is the only way anything reaches it: the security rules deny all
// client access. Thin on purpose; the rules about jobs live in service.ts and are tested there against the in-memory fake. This is
// first exercised on the deployment.
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import type { CachedJob, JobCache } from "@/lib/blender/ports";

const JOBS = "blenderOutputs";

const db = () => getFirestore(adminApp());

export class FirestoreJobCache implements JobCache {
  async get(key: string): Promise<CachedJob | null> {
    const snapshot = await db().collection(JOBS).doc(key).get();
    return snapshot.exists ? (snapshot.data() as CachedJob) : null;
  }

  async put(key: string, value: CachedJob): Promise<void> {
    // Firestore refuses `undefined` field values; a JSON round trip drops them. A job is plain JSON data.
    await db().collection(JOBS).doc(key).set(JSON.parse(JSON.stringify(value)) as CachedJob);
  }
}
