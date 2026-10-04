import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type ExecutorContext, NodeError, type Tuning } from "@/lib/graph/types";
import { validateSettings } from "@/lib/settings";

const FIXTURES = fileURLToPath(new URL("../../../../../fixtures/settings/", import.meta.url));
const tuningOf = (file: string): Tuning => JSON.parse(readFileSync(FIXTURES + file, "utf8")).tuning;

const ctx = {} as ExecutorContext;
const tuning: Tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
const SHA = "c".repeat(64);

describe("the Game Template node", () => {
  it("makes valid settings from the defaults when nothing is connected", async () => {
    const { output, result } = await gameTemplate({}, { tuning }, ctx);

    expect(output?.type).toBe("settings");
    if (output?.type !== "settings") return;
    const checked = validateSettings(output.settingsText);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.settings).toEqual({
      schemaVersion: 1,
      template: "runner",
      palette: [...SAMPLE_PALETTE],
      roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" },
      tuning,
    });
    expect(output.tuning).toEqual(tuning);
    expect(output.models).toEqual({
      hero: { kind: "builtin", role: "hero" },
      obstacle: { kind: "builtin", role: "obstacle" },
      collectible: { kind: "builtin", role: "collectible" },
    });
    expect(result).toEqual({ tuning });
  });

  it("uses the feel that is connected instead of its own sliders, and leaves its own setting alone", async () => {
    const feel = { type: "feel" as const, tuning: { speed: 8, jumpHeight: 3, obstacleSpacing: 20 } };
    const params = { tuning };
    const { output, result } = await gameTemplate({ feel }, params, ctx);

    expect(output?.type === "settings" && output.tuning).toEqual(feel.tuning);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).tuning).toEqual(feel.tuning);
    expect(result).toEqual({ tuning: feel.tuning });
    expect(params.tuning).toEqual(tuning); // unplugging the feel brings the sliders' values back
  });

  it("still checks a feel exactly as it checks its own numbers", async () => {
    const unplayable = { type: "feel" as const, tuning: { speed: 12, jumpHeight: 1.5, obstacleSpacing: 4 } };
    await expect(gameTemplate({ feel: unplayable }, { tuning }, ctx)).rejects.toBeInstanceOf(NodeError);
  });

  it("uses the palette that is connected", async () => {
    const colors = ["#000000", "#111111", "#222222", "#333333", "#ffffff"];
    const { output } = await gameTemplate({ palette: { type: "palette", colors } }, { tuning }, ctx);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).palette).toEqual(colors);
  });

  it("uses a connected model for its role and the built-in shapes for the others", async () => {
    const hero = { type: "model" as const, sha256: SHA, name: "hero.glb", size: 100, format: "glb" as const };
    const { output } = await gameTemplate({ hero }, { tuning }, ctx);
    expect(output?.type === "settings" && output.models).toEqual({
      hero: { kind: "asset", sha256: SHA },
      obstacle: { kind: "builtin", role: "obstacle" },
      collectible: { kind: "builtin", role: "collectible" },
    });
  });

  it("refuses an unplayable tuning with the slice 2 message, under its own name", async () => {
    const bad = tuningOf("invalid-unwinnable-jump.json");
    const settings = JSON.stringify(JSON.parse(readFileSync(FIXTURES + "invalid-unwinnable-jump.json", "utf8")));
    const expected = validateSettings(settings);
    expect(expected.ok).toBe(false);

    const failure = await gameTemplate({}, { tuning: bad }, ctx).catch((e) => e);
    expect(failure).toBeInstanceOf(NodeError);
    expect(failure.message).toBe(`Game Template: ${expected.ok ? "" : expected.error}`);
  });

  it("accepts the tuning at the top of the allowed ranges", async () => {
    const { output } = await gameTemplate({}, { tuning: tuningOf("valid-range-max.json") }, ctx);
    expect(output?.type).toBe("settings");
  });
});
