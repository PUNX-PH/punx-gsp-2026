// What names a cached script from Claude. Pure. The key hashes canonical JSON (so the order of keys inside an object does not matter), and the person
// is in it so nobody can reuse, or infer, another person's words.
import { hashKey } from "@/lib/blender/key";
import { SCRIPT_VERSION } from "./api";

/**
 * A script: the cleaned description, the picture's hash (or null), the names of the models wired in (sorted) and how many times the person pressed Try
 * again. `SCRIPT_VERSION` is part of the key: change it when the prompt, the schema or the check change what the same words give.
 */
export const scriptKey = (input: { model: string; uid: string; description: string; pictureSha: string | null; models: string[]; attempt: number }): Promise<string> =>
  hashKey([SCRIPT_VERSION, "script", input.model, input.uid, input.description, input.pictureSha, [...input.models].sort(), input.attempt]);
