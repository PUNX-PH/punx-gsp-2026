import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/graph/palette";

// The theme colors are CSS tokens; this holds them to the contrast the editor promises: text at least 4.5 to 1.
const css = readFileSync(new URL("./editor.module.css", import.meta.url), "utf8");

function block(selector: string): string {
  const start = css.indexOf(selector + " {");
  if (start < 0) throw new Error(`no ${selector} block`);
  return css.slice(start, css.indexOf("}", start));
}

function tokens(selector: string): Record<string, string> {
  return Object.fromEntries([...block(selector).matchAll(/--([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2]]));
}

const THEMES: [string, Record<string, string>][] = [
  ["dark", tokens(".editor")],
  ["light", { ...tokens(".editor"), ...tokens('.editor[data-theme="light"]') }],
];

describe.each(THEMES)("the %s theme", (_name, t) => {
  it.each([
    ["text on a card", "text", "surface"],
    ["text on the canvas", "text", "canvas"],
    ["muted text on a card", "muted", "surface"],
    ["muted text on the canvas", "muted", "canvas"],
    ["muted text on a raised surface", "muted", "surface-raised"],
    ["the text of the Play button on its accent", "on-accent", "accent"],
    ["the order number on its accent", "on-accent", "accent"],
    ["the status line of a step that is not used, on its card", "idle", "surface"],
  ])("%s has at least 4.5 to 1 contrast", (_label, foreground, background) => {
    expect(contrastRatio(t[foreground], t[background])).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the empty game message", () => {
  it("is a fixed light color, because the game area is always black, and readable on it", () => {
    const color = block(".gameEmpty").match(/color:\s*(#[0-9a-fA-F]{6})\s*;/)?.[1];
    expect(color, "the message needs its own literal color, not a theme token").toBeDefined();
    expect(contrastRatio(color!, "#000000")).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the stylesheet's other rules (deferred minors)", () => {
  it("keeps the color of a selected wire: React Flow's own rule for a selected edge would turn it grey", () => {
    // That rule is .react-flow__edge.selected .react-flow__edge-path (three classes), so ours needs more than one.
    const rule = block(".canvasArea :global(.react-flow__edge.selected) .edgePath");
    expect(rule).toMatch(/stroke:\s*var\(--wire\)/);
  });

  it("tells the browser which theme the editor is in, so scroll bars and form controls match it", () => {
    expect(block(".editor")).toMatch(/color-scheme:\s*dark/);
    expect(block('.editor[data-theme="light"]')).toMatch(/color-scheme:\s*light/);
  });

  it("does not dim a step that is not used as a whole: its small text would fall below 4.5 to 1 (the status line is 4.7 before any dimming)", () => {
    expect(block('.card[data-status="not-used"]')).not.toMatch(/opacity/);
  });

  it("wraps a long file name in an error line, and keeps its direction marks from reaching the text around it", () => {
    expect(block(".errorText")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(block(".errorText")).toMatch(/unicode-bidi:\s*isolate/);
    expect(block(".fileName")).toMatch(/unicode-bidi:\s*isolate/);
  });

  it("has a way to hide text from the eye but not from a screen reader", () => {
    expect(block(".visuallyHidden")).toMatch(/clip(-path)?:/);
  });
});
