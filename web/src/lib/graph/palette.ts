// Five colors from a picture, for the Unity runner template. The template reads them by position (slot 0 is the
// background and the text on the HUD panel, 1 the ground, 2 the HUD panel, 3 is not used, 4 is the score text), so the
// colors are not just the most common ones: they are put in those slots by lightness and nudged until the text can be
// read. Everything here is deterministic, so a picture always gives the same palette.

export const SAMPLE_PALETTE: readonly string[] = ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"];

/** The least contrast (WCAG ratio, 1 to 21) each pairing of slots may have. */
export const PALETTE_RULES = { scoreOnBackground: 4.5, hudTextOnPanel: 3, groundOnBackground: 1.5 } as const;

const SLOTS = 5;
const NUDGE = 0.01; // one step of HSL lightness
const FILL_STEP = 0.18; // lightness difference of a color made up for a picture that has too few

type Rgb = [number, number, number];
type Hsl = [number, number, number]; // hue 0..360, saturation 0..1, lightness 0..1

// ---- color maths ----

function hexToRgb(hex: string): Rgb {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHex([r, g, b]: Rgb): string {
  return "#" + [r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("");
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: Hsl): Rgb {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    const x = (t + 360) % 360;
    const v = x < 60 ? p + (q - p) * (x / 60) : x < 180 ? q : x < 240 ? p + (q - p) * ((240 - x) / 60) : p;
    return v * 255;
  };
  return [channel(h + 120), channel(h), channel(h - 120)];
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two `#rrggbb` colors: 1 (the same) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function withLightness(hex: string, lightness: number): string {
  const [h, s] = rgbToHsl(hexToRgb(hex));
  return rgbToHex(hslToRgb([h, s, Math.max(0, Math.min(1, lightness))]));
}

const lightnessOf = (hex: string) => rgbToHsl(hexToRgb(hex))[2];
const saturationOf = (hex: string) => rgbToHsl(hexToRgb(hex))[1];

// ---- median cut ----

function widestChannel(box: Rgb[]): { channel: 0 | 1 | 2; range: number } {
  let best = { channel: 0 as 0 | 1 | 2, range: 0 };
  for (const channel of [0, 1, 2] as const) {
    let min = 255;
    let max = 0;
    for (const pixel of box) {
      min = Math.min(min, pixel[channel]);
      max = Math.max(max, pixel[channel]);
    }
    if (max - min > best.range) best = { channel, range: max - min };
  }
  return best;
}

// Sorts the box by one channel and cuts at the value boundary nearest the middle, never inside a run of equal values.
function split(box: Rgb[], channel: 0 | 1 | 2): [Rgb[], Rgb[]] {
  const sorted = [...box].sort((a, b) => a[channel] - b[channel] || a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  let cut = -1;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i][channel] === sorted[i - 1][channel]) continue;
    if (cut < 0 || Math.abs(i - sorted.length / 2) < Math.abs(cut - sorted.length / 2)) cut = i;
  }
  return [sorted.slice(0, cut), sorted.slice(cut)];
}

function mean(box: Rgb[]): Rgb {
  const sum = box.reduce<Rgb>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0]);
  return [sum[0] / box.length, sum[1] / box.length, sum[2] / box.length].map(Math.round) as Rgb;
}

function dominantColors(pixels: Uint8Array): string[] {
  const all: Rgb[] = [];
  for (let i = 0; i + 2 < pixels.length; i += 3) all.push([pixels[i], pixels[i + 1], pixels[i + 2]]);

  const boxes: Rgb[][] = [all];
  while (boxes.length < SLOTS) {
    let target = -1;
    let targetChannel: 0 | 1 | 2 = 0;
    let targetRange = 0;
    boxes.forEach((box, index) => {
      const { channel, range } = widestChannel(box);
      if (range > targetRange) [target, targetChannel, targetRange] = [index, channel, range];
    });
    if (target < 0) break; // every box is one color: nothing left to split
    boxes.splice(target, 1, ...split(boxes[target], targetChannel));
  }
  return boxes.map((box) => rgbToHex(mean(box)));
}

// A picture with fewer than five colors is filled out with lighter and darker versions of what it has.
function fillOut(colors: string[]): string[] {
  const filled = [...colors];
  for (let k = 0; filled.length < SLOTS; k++) {
    const base = colors[k % colors.length];
    const round = Math.floor(k / colors.length) + 1;
    const towardsDark = (lightnessOf(base) > 0.5) === (k % 2 === 0);
    filled.push(withLightness(base, lightnessOf(base) + (towardsDark ? -1 : 1) * FILL_STEP * round));
  }
  return filled;
}

// ---- slots and readability ----

function nudge(color: string, direction: 1 | -1, enough: (c: string) => boolean): string {
  let current = color;
  while (!enough(current)) {
    const lightness = lightnessOf(current);
    if (direction === 1 ? lightness >= 1 : lightness <= 0) break;
    current = withLightness(current, lightness + direction * NUDGE);
  }
  return current;
}

/** Five `#rrggbb` colors for the template's slots, from packed RGB triples (at least one pixel). */
export function makePalette(pixels: Uint8Array): string[] {
  if (pixels.length < 3) throw new Error("makePalette needs at least one pixel");

  const byLight = fillOut(dominantColors(pixels)).sort((a, b) => luminance(a) - luminance(b) || (a < b ? -1 : 1));
  // The ground is the most saturated of the middle three (the darker one on a tie); of the other two, the lighter is
  // the HUD panel. Removing it by position keeps identical colors apart.
  const middle = byLight.slice(1, 4);
  const groundAt = middle.reduce((best, c, i) => (saturationOf(c) > saturationOf(middle[best]) ? i : best), 0);
  const [spare, panel] = middle.filter((_, i) => i !== groundAt);

  let background = byLight[0];
  let score = byLight[4];
  let hudPanel = panel;
  let groundColor = middle[groundAt];

  // The score must read on the background: darken the background first, then lighten the score.
  const scoreReads = () => contrastRatio(score, background) >= PALETTE_RULES.scoreOnBackground;
  background = nudge(background, -1, () => scoreReads());
  score = nudge(score, 1, () => scoreReads());

  // HUD text (slot 0) must read on the panel; the ground must stand out from the background.
  hudPanel = nudge(hudPanel, 1, (c) => contrastRatio(background, c) >= PALETTE_RULES.hudTextOnPanel);
  groundColor = nudge(groundColor, 1, (c) => contrastRatio(c, background) >= PALETTE_RULES.groundOnBackground);

  return [background, groundColor, hudPanel, spare, score];
}
