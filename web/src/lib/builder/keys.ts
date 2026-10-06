// What names a cached design, motion or environment answer from Claude. Pure. Every key hashes a list through `hashKey` (canonical
// JSON, so the order of keys inside an object does not matter), and the person is in every key so nobody can reuse, or infer,
// another person's words.
import { hashKey } from "@/lib/blender/key";
import type { ClipKey, ModelKind } from "@/lib/builder/kinds";
import type { Role } from "@/lib/graph/types";

/** Part of every key: change it when the prompts, the schemas or the repair rules change, so old answers are not reused. */
export const RECIPE_VERSION = 1;

/** The look of a model: the cleaned description, the kind setting ("auto" or a kind), the role and the picture's hash (or null). */
export const designKey = (input: { model: string; uid: string; description: string; kind: ModelKind | "auto"; role: Role; pictureSha: string | null }): Promise<string> =>
  hashKey([RECIPE_VERSION, "design", input.model, input.uid, input.description, input.kind, input.role, input.pictureSha]);

/**
 * The motions of a model: its kind, its joints in the kit's order (a tail adds some, so it is another key) and the cleaned text of
 * every clip the role has, "" for an empty box.
 */
export const motionKey = (input: { model: string; uid: string; kind: ModelKind; joints: string[]; texts: Partial<Record<ClipKey, string>> }): Promise<string> =>
  hashKey([RECIPE_VERSION, "motion", input.model, input.uid, input.kind, input.joints, input.texts]);

/** The world around the game: the cleaned theme. */
export const environmentKey = (input: { model: string; uid: string; theme: string }): Promise<string> =>
  hashKey([RECIPE_VERSION, "environment", input.model, input.uid, input.theme]);
