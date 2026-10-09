// Reads the stored Claude answers (Firestore, Admin SDK) as usage records: the time and the token counts of each, nothing else, and only the recent ones.
import { getFirestore } from "firebase-admin/firestore";
import { adminApp } from "@/lib/auth/firebaseAdmin";
import type { UsageRecord } from "./summary";

/** The collections that keep an answer with its token counts, and what each one is for. */
export const KINDS: readonly { collection: string; kind: string }[] = [
  { collection: "gameScripts", kind: "Game plan and code" },
  { collection: "builderDesigns", kind: "Model and scenery designs" },
  { collection: "builderMotions", kind: "Animations" },
  { collection: "builderEnvironments", kind: "Worlds (Build Environment)" },
  { collection: "gameSpecs", kind: "Rules games" },
  { collection: "aiAnswers", kind: "Colors and feel" },
];

export async function readUsage(sinceMs: number): Promise<UsageRecord[]> {
  const db = getFirestore(adminApp());
  const found = await Promise.all(
    KINDS.map(async ({ collection, kind }) => {
      const snapshot = await db.collection(collection).where("createdAt", ">=", sinceMs).select("createdAt", "inputTokens", "outputTokens").get();
      return snapshot.docs.flatMap((doc) => {
        const d = doc.data();
        return typeof d.createdAt === "number" && typeof d.inputTokens === "number" && typeof d.outputTokens === "number"
          ? [{ kind, at: d.createdAt, inputTokens: d.inputTokens, outputTokens: d.outputTokens }]
          : [];
      });
    }),
  );
  return found.flat();
}
