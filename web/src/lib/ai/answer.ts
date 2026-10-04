// Nothing the model says is trusted. This turns what it said into a DescribedGame the rest of the platform can use, or says
// it cannot: the shape is checked, the colors are made readable, and numbers that cannot be played are repaired if the only
// problem is the obstacle spacing. Pure.
import { TUNING_FIELDS } from "@/lib/canvas/tuning";
import { guardPalette } from "@/lib/graph/palette";
import { minPlayableSpacing, winnabilityError } from "@/lib/settings";
import type { DescribedGame } from "@/lib/ai/types";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const MAX_SUMMARY = 140;
const MAX_SPACING = TUNING_FIELDS.find((f) => f.key === "obstacleSpacing")!.max;
// The template's slots, in order. The model names its colors by what they are for.
const COLOR_NAMES = ["background", "ground", "panel", "accent", "score"] as const;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** What the person typed, ready to use: control characters other than a new line are removed, then it is trimmed. */
export function cleanPrompt(text: string): string {
  return text.replace(/\p{Cc}/gu, (c) => (c === "\n" ? c : "")).trim();
}

export function parseAnswer(raw: unknown): { ok: true; answer: DescribedGame } | { ok: false } {
  const fail = { ok: false } as const;
  if (!isObject(raw) || !isObject(raw.palette) || !isObject(raw.tuning)) return fail;

  const colors = COLOR_NAMES.map((name) => (raw.palette as Record<string, unknown>)[name]);
  if (!colors.every((c): c is string => typeof c === "string" && HEX_COLOR.test(c))) return fail;

  const numbers: Record<string, number> = {};
  for (const field of TUNING_FIELDS) {
    const value = (raw.tuning as Record<string, unknown>)[field.key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < field.min || value > field.max) return fail;
    numbers[field.key] = value;
  }
  const { speed, jumpHeight } = numbers;

  if (typeof raw.summary !== "string") return fail;
  const summary = raw.summary.trim();
  if (Array.from(summary).length > MAX_SUMMARY || /\p{Cc}/u.test(summary)) return fail;

  // Too short a spacing is the one thing that can be mended without asking again: raise it to the smallest playable value.
  let obstacleSpacing = numbers.obstacleSpacing;
  const smallest = minPlayableSpacing(speed, jumpHeight);
  if (obstacleSpacing < smallest) {
    if (smallest > MAX_SPACING) return fail;
    obstacleSpacing = smallest;
  }
  if (winnabilityError(speed, jumpHeight, obstacleSpacing) !== null) return fail; // a jump too low for the speed cannot be mended

  return {
    ok: true,
    answer: { palette: guardPalette(colors.map((c) => c.toLowerCase())), tuning: { speed, jumpHeight, obstacleSpacing }, summary },
  };
}
