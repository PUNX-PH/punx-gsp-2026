// What names a cached game from Claude. Pure. The key hashes canonical JSON (so the order of keys inside an object does not matter), and the person
// is in it so nobody can reuse, or infer, another person's words.
import { hashKey } from "@/lib/blender/key";
import { ENGINE_VERSION } from "./spec";

/**
 * A game: the cleaned description, the picture's hash (or null) and the names of the models wired in (sorted). `ENGINE_VERSION` is part of the key:
 * change it when the prompt, the schema, the repair or the playtest change what the same words give.
 */
export const gameKey = (input: { model: string; uid: string; description: string; pictureSha: string | null; models: string[] }): Promise<string> =>
  hashKey([ENGINE_VERSION, "game", input.model, input.uid, input.description, input.pictureSha, [...input.models].sort()]);
