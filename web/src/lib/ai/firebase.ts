// The real AnswerCache and UsageLimits (Firestore), through the Admin SDK, which is the only way anything reaches them: the
// security rules deny all client access. Thin on purpose; the rules about answers and limits live in service.ts and are
// tested there against the in-memory fakes. These are first exercised on the deployment.
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import { personDocId, siteDocId } from "@/lib/ai/key";
import type { AnswerCache, CachedAnswer, TakeResult, UsageLimits } from "@/lib/ai/ports";

const ANSWERS = "aiAnswers";
const USAGE = "aiUsage";

const db = () => getFirestore(adminApp());

// Firestore refuses `undefined` field values; a JSON round trip drops them. Everything stored here is plain JSON data.
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export class FirestoreAnswerCache implements AnswerCache {
  async get(key: string): Promise<CachedAnswer | null> {
    const snapshot = await db().collection(ANSWERS).doc(key).get();
    return snapshot.exists ? (snapshot.data() as CachedAnswer) : null;
  }

  async put(key: string, value: CachedAnswer): Promise<void> {
    await db().collection(ANSWERS).doc(key).set(plain(value));
  }
}

export class FirestoreUsageLimits implements UsageLimits {
  // Describe Game counts in `aiUsage`; other services that share these rules (Blender) count in a collection of their own.
  constructor(private readonly collection: string = USAGE) {}

  // One transaction reads and counts the person's day and the site's day together, so two simultaneous requests cannot both
  // slip under a limit.
  async take(uid: string, day: string, limits: { perPerson: number; total: number }): Promise<TakeResult> {
    const person = db().collection(this.collection).doc(personDocId(uid, day));
    const site = db().collection(this.collection).doc(siteDocId(day));
    return db().runTransaction(async (transaction) => {
      const [mine, all] = await Promise.all([transaction.get(person), transaction.get(site)]);
      const mineCount = (mine.data()?.count as number | undefined) ?? 0;
      const allCount = (all.data()?.count as number | undefined) ?? 0;
      if (mineCount >= limits.perPerson) return "person-limit";
      if (allCount >= limits.total) return "site-limit";
      transaction.set(person, { count: mineCount + 1 });
      transaction.set(site, { count: allCount + 1 });
      return "ok";
    });
  }

  async give(uid: string, day: string): Promise<void> {
    const person = db().collection(this.collection).doc(personDocId(uid, day));
    const site = db().collection(this.collection).doc(siteDocId(day));
    await db().runTransaction(async (transaction) => {
      const [mine, all] = await Promise.all([transaction.get(person), transaction.get(site)]);
      transaction.set(person, { count: Math.max(0, ((mine.data()?.count as number | undefined) ?? 0) - 1) });
      transaction.set(site, { count: Math.max(0, ((all.data()?.count as number | undefined) ?? 0) - 1) });
    });
  }
}
