// What names a cached answer and a day's usage. Pure.
import { sha256Hex } from "@/lib/runs/service";

/** Part of every cache key: change it when the rules that check or repair an answer change, so old answers are not reused. */
export const ANSWER_VERSION = 1;

/**
 * The name of the answer to this question: the same person, prompt, picture and model (under the same rules) always give
 * the same key, and anything else gives another. The person is in it so nobody can reuse, or infer, another person's prompts.
 * The parts are encoded as a list, so text cannot run one field into the next.
 */
export async function answerKey(input: { model: string; uid: string; prompt: string; pictureSha: string | null }): Promise<string> {
  const text = JSON.stringify([ANSWER_VERSION, input.model, input.uid, input.prompt, input.pictureSha]);
  return sha256Hex(new TextEncoder().encode(text));
}

/** The UTC date as yyyymmdd: the day the limits count in. */
export function dayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");
}

/** The usage document of one person on one day. Refuses an id Firestore would not take as part of a document id. */
export function personDocId(uid: string, day: string): string {
  if (uid === "" || uid.includes("/")) throw new Error("invalid person id");
  return `u_${uid}_${day}`;
}

/** The usage document of the whole site on one day. */
export const siteDocId = (day: string): string => `site_${day}`;
