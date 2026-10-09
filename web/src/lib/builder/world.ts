// The art style and the world of a made game, as Claude plans them in the same answer as the script: one style for every model, and the sky, the ground and
// the scenery around the field. Claude's answer is untrusted: these repair it (palette slots clamped, words cleaned and cut, at most three pieces of scenery),
// they never fail the game. Pure.
import { cleanPrompt } from "@/lib/ai/answer";

export const ART_STYLES = ["realistic", "stylized", "cartoon", "painted", "flat"] as const;
export type ArtStyle = (typeof ART_STYLES)[number];

/** The look a game gets when Claude names none (or one that is not in the list). */
export const DEFAULT_STYLE: ArtStyle = "stylized";

export const MAX_SCENERY = 3;
const MAX_SCENERY_WORDS = 300;

/** The world around a game's field: palette indexes 0 to 4 for the sky and the ground, and the scenery in words (each piece is built as a model of its own). */
export interface WorldPlan {
  sky: number;
  ground: number;
  scenery: { description: string }[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function repairStyle(raw: unknown): ArtStyle {
  return typeof raw === "string" && (ART_STYLES as readonly string[]).includes(raw) ? (raw as ArtStyle) : DEFAULT_STYLE;
}

/** Claude counts palette slots 1 to 5 (as in the script API); the settings count 0 to 4. */
const slot = (raw: unknown, fallback: number): number => (typeof raw === "number" && Number.isFinite(raw) ? Math.min(4, Math.max(0, Math.round(raw) - 1)) : fallback);

/** The world as a plan, or null when Claude gave none worth building (no scenery and no colors). Scenery with no words is dropped. */
export function repairWorld(raw: unknown): WorldPlan | null {
  if (!isObject(raw)) return null;
  const scenery = (Array.isArray(raw.scenery) ? raw.scenery : [])
    .filter((piece): piece is Record<string, unknown> => isObject(piece) && typeof piece.description === "string")
    .map((piece) => ({ description: Array.from(cleanPrompt(piece.description as string)).slice(0, MAX_SCENERY_WORDS).join("") }))
    .filter((piece) => piece.description !== "")
    .slice(0, MAX_SCENERY);
  const hasColors = typeof raw.sky === "number" || typeof raw.ground === "number";
  if (scenery.length === 0 && !hasColors) return null;
  return { sky: slot(raw.sky, 0), ground: slot(raw.ground, 3), scenery };
}
