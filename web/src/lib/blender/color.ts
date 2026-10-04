// Which color a Blender step paints with. Pure.
import { SAMPLE_PALETTE } from "@/lib/graph/palette";

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * "original" keeps the model's own colors (null). A swatch from 1 to 5 is that entry of the wired palette, or of the sample
 * palette when none is wired (or the entry is not a `#rrggbb` color), lower-cased. Anything else is a settings error that the
 * save check should have caught, so it throws.
 */
export function resolveColor(setting: unknown, palette: readonly string[] | null): string | null {
  if (setting === "original") return null;
  if (typeof setting !== "number" || !Number.isInteger(setting) || setting < 1 || setting > 5) throw new Error("bad color setting");
  const given = palette?.[setting - 1];
  return (typeof given === "string" && HEX.test(given) ? given : SAMPLE_PALETTE[setting - 1]).toLowerCase();
}
