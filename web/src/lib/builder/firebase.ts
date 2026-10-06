// The real RecipeCache (Firestore), through the Admin SDK, which is the only way anything reaches it: the security rules deny all
// client access. Thin on purpose; the rules about designs and motions live in service.ts and are tested there against the in-memory
// fake. This is first exercised on the deployment. Firestore may hand an object's keys back in another order, which is why the
// cache keys hash canonical JSON.
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import type { CachedRecipe, RecipeCache } from "@/lib/builder/ports";

const db = () => getFirestore(adminApp());

export class FirestoreRecipeCache<T> implements RecipeCache<T> {
  /** `collection` is one of `builderDesigns`, `builderMotions`, `builderEnvironments`. */
  constructor(private readonly collection: string) {}

  async get(key: string): Promise<CachedRecipe<T> | null> {
    const snapshot = await db().collection(this.collection).doc(key).get();
    return snapshot.exists ? (snapshot.data() as CachedRecipe<T>) : null;
  }

  async put(key: string, value: CachedRecipe<T>): Promise<void> {
    // Firestore refuses `undefined` field values; a JSON round trip drops them. A recipe is plain JSON data.
    await db().collection(this.collection).doc(key).set(JSON.parse(JSON.stringify(value)) as CachedRecipe<T>);
  }
}
