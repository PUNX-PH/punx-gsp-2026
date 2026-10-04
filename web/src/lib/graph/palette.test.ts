import { describe, expect, it } from "vitest";
import { contrastRatio, guardPalette, makePalette, PALETTE_RULES, SAMPLE_PALETTE } from "@/lib/graph/palette";

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** RGB triples: `count` pixels of each color, in the given order. */
function pixelsOf(colors: [string, number][]): Uint8Array {
  const out: number[] = [];
  for (const [hex, count] of colors) for (let i = 0; i < count; i++) out.push(...rgb(hex));
  return Uint8Array.from(out);
}

/** Pixels from a seeded linear congruential generator, so the picture is the same every run. */
function noise(count: number, seed: number): Uint8Array {
  let state = seed;
  const next = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  return Uint8Array.from({ length: count * 3 }, () => Math.floor(next() * 256));
}

function expectReadable(p: string[]) {
  expect(p).toHaveLength(5);
  for (const color of p) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  expect(contrastRatio(p[4], p[0])).toBeGreaterThanOrEqual(PALETTE_RULES.scoreOnBackground);
  expect(contrastRatio(p[0], p[2])).toBeGreaterThanOrEqual(PALETTE_RULES.hudTextOnPanel);
  expect(contrastRatio(p[1], p[0])).toBeGreaterThanOrEqual(PALETTE_RULES.groundOnBackground);
}

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBeCloseTo(1, 5);
  });
});

describe("the sample palette", () => {
  it("is the one in the spec", () => {
    expect([...SAMPLE_PALETTE]).toEqual(["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"]);
  });
});

describe("makePalette", () => {
  it("gives the same five colors for the same pixels, and leaves its input alone", () => {
    const pixels = noise(500, 7);
    const copy = pixels.slice();
    const first = makePalette(pixels);
    expect(makePalette(pixels)).toEqual(first);
    expect(pixels).toEqual(copy);
    expect(first).toHaveLength(5);
    for (const color of first) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("puts the darkest color in slot 0, the lightest in slot 4, the most saturated of the rest in slot 1, and the lighter of the remaining two in slot 2", () => {
    const shuffled: [string, number][] = [
      ["#808080", 10],
      ["#f0f0f0", 10],
      ["#ff0000", 10],
      ["#101030", 10],
      ["#c0c0c0", 10],
    ];
    expect(makePalette(pixelsOf(shuffled))).toEqual(["#101030", "#ff0000", "#c0c0c0", "#808080", "#f0f0f0"]);
  });

  it.each([
    ["five light pastels", pixelsOf([["#ffd6e0", 20], ["#ffefcf", 20], ["#d4f0f0", 20], ["#e0d4f7", 20], ["#fdfdc0", 20]])],
    ["five dark colors", pixelsOf([["#0a0a14", 20], ["#14081c", 20], ["#081c14", 20], ["#1c1408", 20], ["#10101c", 20]])],
    ["flat white", pixelsOf([["#ffffff", 50]])],
    ["flat black", pixelsOf([["#000000", 50]])],
    ["flat mid-grey", pixelsOf([["#808080", 50]])],
    ["2000 noisy pixels", noise(2000, 12345)],
    ["a flat blue", pixelsOf([["#3366cc", 50]])],
    ["two colors", pixelsOf([["#ff0000", 30], ["#0000ff", 30]])],
    ["a single pixel", pixelsOf([["#c83232", 1]])],
    ["four pixels", pixelsOf([["#c83232", 1], ["#32c832", 1], ["#3232c8", 1], ["#c8c832", 1]])],
  ])("gives five valid, readable colors for %s", (_label, pixels) => {
    expectReadable(makePalette(pixels));
  });

  it("refuses to make a palette from nothing", () => {
    expect(() => makePalette(new Uint8Array(0))).toThrow();
  });
});

describe("guardPalette (the readability rules on five colors that were not taken from pixels)", () => {
  // Slot order: background, ground, panel, accent, score.
  const reads = ([background, ground, panel, , score]: string[]) => {
    expect(contrastRatio(score, background)).toBeGreaterThanOrEqual(PALETTE_RULES.scoreOnBackground);
    expect(contrastRatio(background, panel)).toBeGreaterThanOrEqual(PALETTE_RULES.hudTextOnPanel);
    expect(contrastRatio(ground, background)).toBeGreaterThanOrEqual(PALETTE_RULES.groundOnBackground);
  };

  it("leaves colors that already read exactly as they are", () => {
    expect(guardPalette([...SAMPLE_PALETTE])).toEqual([...SAMPLE_PALETTE]);
  });

  it("fixes a score that cannot be read on the background, and keeps the order and the count", () => {
    const fixed = guardPalette(["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#222222"]);
    expect(fixed).toHaveLength(5);
    reads(fixed);
    expect(fixed[3]).toBe("#06d6a0"); // the accent has no rule and is left alone
  });

  it("makes a palette of five identical colors readable", () => {
    const fixed = guardPalette(Array(5).fill("#808080"));
    expect(fixed).toHaveLength(5);
    reads(fixed);
  });

  // A model can choose a light sky: the rules must hold in the other direction too (HUD text and score are dark, the panel is darker still).
  it("makes a light sky with a dark score readable without touching the colors that already read", () => {
    const fixed = guardPalette(["#f0f4f8", "#e2e8f0", "#ffffff", "#ff6f59", "#1f2937"]);
    reads(fixed);
    expect(fixed[0]).toBe("#f0f4f8"); // the sky and the score already read together
    expect(fixed[4]).toBe("#1f2937");
    expect(fixed[3]).toBe("#ff6f59");
  });

  it("moves a light score away from a light sky instead of driving the sky to black", () => {
    const fixed = guardPalette(["#f0f4f8", "#9ca3af", "#475569", "#ff6f59", "#e5e7eb"]);
    reads(fixed);
    expect(contrastRatio(fixed[0], "#ffffff")).toBeLessThan(1.5); // the sky is still light
    expect(contrastRatio(fixed[4], fixed[0])).toBeLessThan(8); // and the score stops where it reads, not at black
  });

  it("darkens a sky-blue sky only as far as a white score needs", () => {
    const fixed = guardPalette(["#87ceeb", "#2e8b57", "#ffffff", "#ff6f59", "#ffffff"]);
    reads(fixed);
    expect(fixed[4]).toBe("#ffffff");
    expect(contrastRatio(fixed[4], fixed[0])).toBeLessThan(5); // not an overshoot to black (21)
    expect(fixed[0]).not.toBe("#000000");
  });

  it("refuses anything but five colors", () => {
    expect(() => guardPalette(["#000000", "#111111", "#222222", "#333333"])).toThrow("guardPalette needs five colors");
    expect(() => guardPalette([...SAMPLE_PALETTE, "#ffffff"])).toThrow("guardPalette needs five colors");
  });
});
