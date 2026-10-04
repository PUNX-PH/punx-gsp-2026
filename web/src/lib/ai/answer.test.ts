import { describe, expect, it } from "vitest";
import { cleanPrompt, parseAnswer } from "@/lib/ai/answer";
import { guardPalette } from "@/lib/graph/palette";
import { minPlayableSpacing, winnabilityError } from "@/lib/settings";

type Raw = { palette: Record<string, unknown>; tuning: Record<string, unknown>; summary: unknown; [key: string]: unknown };

const good = (): Raw => ({
  palette: { background: "#1b1f3b", ground: "#ff6f59", panel: "#ffd166", accent: "#06d6a0", score: "#ffffff" },
  tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 },
  summary: "A fast neon night run.",
});

/** A good answer with one change. */
const changed = (change: (raw: Raw) => void): Raw => {
  const raw = good();
  change(raw);
  return raw;
};

describe("cleanPrompt", () => {
  it("removes control characters other than a new line, then trims", () => {
    expect(cleanPrompt("  a\u0007b \n c  ")).toBe("ab \n c");
    expect(cleanPrompt("\u0000\u001b[31mred\u007f")).toBe("[31mred");
  });

  it("keeps ordinary text, emoji and right-to-left text as they are", () => {
    expect(cleanPrompt("a spooky 👻 run, مرحبا")).toBe("a spooky 👻 run, مرحبا");
  });

  it("gives an empty string for a prompt of only spaces and control characters", () => {
    expect(cleanPrompt(" \u0007 \t ")).toBe("");
  });
});

describe("parseAnswer accepts", () => {
  it("a good answer, with the colors put in slot order and guarded, and the numbers as given", () => {
    const parsed = parseAnswer(good());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.answer.palette).toEqual(guardPalette(["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"]));
    expect(parsed.answer.tuning).toEqual({ speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 });
    expect(parsed.answer.summary).toBe("A fast neon night run.");
  });

  it("uppercase hex (lowercased), unknown extra keys (ignored), and a summary with spaces around it (trimmed)", () => {
    const raw = changed((r) => {
      r.palette.ground = "#FF6F59";
      r.extra = "ignored";
      r.summary = "  spaced  ";
    });
    const parsed = parseAnswer(raw);
    expect(parsed.ok && parsed.answer.palette[1]).toBe("#ff6f59");
    expect(parsed.ok && parsed.answer.summary).toBe("spaced");
  });

  it("a summary of exactly 140 characters", () => {
    expect(parseAnswer(changed((r) => (r.summary = "s".repeat(140)))).ok).toBe(true);
  });
});

describe("parseAnswer refuses", () => {
  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["a string", "a fast game"],
    ["null", null],
    ["an array", []],
    ["a missing palette", changed((r) => delete (r as Partial<Raw>).palette)],
    ["a missing tuning", changed((r) => delete (r as Partial<Raw>).tuning)],
    ["a missing summary", changed((r) => delete (r as Partial<Raw>).summary)],
    ["a missing color", changed((r) => delete r.palette.accent)],
    ["a three-digit color", changed((r) => (r.palette.ground = "#fff"))],
    ["a named color", changed((r) => (r.palette.ground = "red"))],
    ["a color with no #", changed((r) => (r.palette.ground = "ff6f59"))],
    ["a color that is a number", changed((r) => (r.palette.ground = 0xff6f59))],
    ["a number given as text", changed((r) => (r.tuning.speed = "6"))],
    ["NaN", changed((r) => (r.tuning.speed = Number.NaN))],
    ["Infinity", changed((r) => (r.tuning.jumpHeight = Number.POSITIVE_INFINITY))],
    ["a speed over 20", changed((r) => (r.tuning.speed = 21))],
    ["a speed under 1", changed((r) => (r.tuning.speed = 0.5))],
    ["a jump under 1.5", changed((r) => (r.tuning.jumpHeight = 1.4))],
    ["a jump over 5", changed((r) => (r.tuning.jumpHeight = 5.1))],
    ["a spacing over 40", changed((r) => (r.tuning.obstacleSpacing = 41))],
    ["a spacing under 4", changed((r) => (r.tuning.obstacleSpacing = 3))],
    ["a summary of 141 characters", changed((r) => (r.summary = "s".repeat(141)))],
    ["a summary that is not text", changed((r) => (r.summary = 5))],
    ["a summary with a control character", changed((r) => (r.summary = "bad\u0000summary"))],
  ])("%s", (_label, raw) => {
    expect(parseAnswer(raw)).toEqual({ ok: false });
  });
});

describe("parseAnswer and the numbers that cannot be played", () => {
  it("raises the obstacle spacing to the smallest playable value when that is the only problem", () => {
    // Precondition: with these numbers it is the spacing, and only the spacing, that is wrong.
    expect(winnabilityError(12, 3, 4)).toMatch(/obstacleSpacing/);
    const parsed = parseAnswer(changed((r) => (r.tuning = { speed: 12, jumpHeight: 3, obstacleSpacing: 4 })));
    expect(parsed.ok && parsed.answer.tuning).toEqual({ speed: 12, jumpHeight: 3, obstacleSpacing: minPlayableSpacing(12, 3) });
    expect(winnabilityError(12, 3, minPlayableSpacing(12, 3))).toBeNull();
  });

  it("leaves a spacing that is already playable alone", () => {
    const parsed = parseAnswer(changed((r) => (r.tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 30 })));
    expect(parsed.ok && parsed.answer.tuning.obstacleSpacing).toBe(30);
  });

  it("refuses a jump that is too low for the speed (a slow game needs a high jump; raising the spacing cannot fix that)", () => {
    expect(winnabilityError(2, 1.5, 40)).toMatch(/jumpHeight/);
    expect(parseAnswer(changed((r) => (r.tuning = { speed: 2, jumpHeight: 1.5, obstacleSpacing: 40 })))).toEqual({ ok: false });
  });

  it("can always mend a spacing within the range: even the most demanding numbers need no more than 40 m", () => {
    // If the rule's constants ever change so that this fails, a repair could leave the range, and parseAnswer then refuses it.
    expect(minPlayableSpacing(20, 5)).toBeLessThanOrEqual(40);
    const parsed = parseAnswer(changed((r) => (r.tuning = { speed: 20, jumpHeight: 5, obstacleSpacing: 4 })));
    expect(parsed.ok && parsed.answer.tuning.obstacleSpacing).toBe(minPlayableSpacing(20, 5));
  });
});
