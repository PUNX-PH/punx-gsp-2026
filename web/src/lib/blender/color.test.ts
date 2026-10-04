import { describe, expect, it } from "vitest";
import { resolveColor } from "@/lib/blender/color";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";

const palette = ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#FFFFFF"];

describe("resolveColor", () => {
  it("gives null for the model's own colors, with or without a palette", () => {
    expect(resolveColor("original", palette)).toBeNull();
    expect(resolveColor("original", null)).toBeNull();
  });

  it("picks the swatch from the wired palette, lower-cased", () => {
    expect(resolveColor(4, palette)).toBe("#06d6a0");
    expect(resolveColor(5, palette)).toBe("#ffffff");
    expect(resolveColor(1, palette)).toBe("#1b1f3b");
  });

  it("uses the sample palette when none is wired", () => {
    expect(resolveColor(4, null)).toBe(SAMPLE_PALETTE[3]);
    expect(resolveColor(2, null)).toBe(SAMPLE_PALETTE[1]);
  });

  it("falls back to the sample palette's color when the wired entry is not a #rrggbb color", () => {
    expect(resolveColor(2, ["#000000", "red", "#000000", "#000000", "#000000"])).toBe(SAMPLE_PALETTE[1]);
    expect(resolveColor(3, ["#000000", "#000000", "#fff", "#000000", "#000000"])).toBe(SAMPLE_PALETTE[2]);
    expect(resolveColor(1, [])).toBe(SAMPLE_PALETTE[0]);
  });

  it.each([[0], [6], [2.5], ["4"], ["red"], [null], [undefined], [-1]])("refuses the setting %s", (setting) => {
    expect(() => resolveColor(setting, palette)).toThrow();
  });
});
