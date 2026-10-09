// The Assemble Game's three sliders, and the live "will this be playable" line under them. The message is the one Play
// would give (it comes from the same validator the Unity template is held to), with the technical path replaced by the
// plain name of the field.
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { ROLE_FILES, type Tuning } from "@/lib/graph/types";
import { validateSettings } from "@/lib/settings";

export interface TuningField {
  key: keyof Tuning;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

export const TUNING_FIELDS: readonly TuningField[] = [
  { key: "speed", label: "How fast it runs", min: 1, max: 20, step: 0.5, unit: "m/s" },
  { key: "jumpHeight", label: "How high it jumps", min: 1.5, max: 5, step: 0.1, unit: "m" },
  { key: "obstacleSpacing", label: "How far apart the obstacles are", min: 4, max: 40, step: 0.5, unit: "m" },
];

const LABELS = Object.fromEntries(TUNING_FIELDS.map((f) => [f.key, f.label]));

/** Why this tuning cannot be played, in plain words, or null when it can. */
export function tuningProblem(tuning: Tuning): string | null {
  const settings = { schemaVersion: 1, template: "runner", palette: [...SAMPLE_PALETTE], roles: ROLE_FILES, tuning };
  const checked = validateSettings(JSON.stringify(settings));
  if (checked.ok) return null;
  return checked.error.replace(/^settings\.tuning\.(\w+):/, (_match, key: string) => `${LABELS[key] ?? key}:`);
}
