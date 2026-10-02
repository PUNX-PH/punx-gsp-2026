import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { rolesNeeded, validateSettings, winnabilityError } from "@/lib/settings";

// web/src/lib -> repo root is three levels up.
const FIXTURES = fileURLToPath(new URL("../../../fixtures/settings/", import.meta.url));
const fixture = (name: string) => readFileSync(FIXTURES + name, "utf8");

// What each invalid fixture's error must contain: the same table as the Unity template's SettingsParserTests.
const EXPECTED_ERROR: Record<string, string> = {
  "invalid-jump-height-1.json": "jumpHeight",
  "invalid-malformed-json.json": "not valid JSON",
  "invalid-palette-bad-hex.json": "palette",
  "invalid-palette-four-colors.json": "palette",
  "invalid-role-not-glb.json": "roles.hero",
  "invalid-role-path-parent.json": "roles.hero",
  "invalid-role-path-subfolder.json": "roles.hero",
  "invalid-roles-missing.json": "roles",
  "invalid-schema-version-2.json": "schemaVersion",
  "invalid-spacing-3.json": "obstacleSpacing",
  "invalid-speed-0.json": "speed",
  "invalid-speed-21.json": "speed",
  "invalid-unknown-template.json": "template",
  "invalid-unwinnable-boundary.json": "jumpHeight", // sits exactly on the edge: only single-precision arithmetic refuses it
  "invalid-unwinnable-jump.json": "jumpHeight",
  "invalid-unwinnable-spacing.json": "obstacleSpacing",
};

const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json"));

function withTuning(speed: number, jumpHeight: number, obstacleSpacing: number): string {
  const base = JSON.parse(fixture("valid.json"));
  base.tuning = { speed, jumpHeight, obstacleSpacing };
  return JSON.stringify(base);
}

function withRoles(hero: string, obstacle: string, collectible: string): string {
  const base = JSON.parse(fixture("valid.json"));
  base.roles = { hero, obstacle, collectible };
  return JSON.stringify(base);
}

describe("shared fixtures (the Unity template accepts and rejects the same files)", () => {
  it("accepts every valid fixture", () => {
    for (const name of files.filter((f) => f.startsWith("valid"))) {
      const result = validateSettings(fixture(name));
      expect(result.ok, `${name}: ${result.ok ? "" : result.error}`).toBe(true);
    }
  });

  it("rejects every invalid fixture with the expected cause", () => {
    for (const name of files.filter((f) => f.startsWith("invalid-"))) {
      const expected = EXPECTED_ERROR[name];
      expect(expected, `${name} has no entry in EXPECTED_ERROR: add it to the table`).toBeDefined();
      const result = validateSettings(fixture(name));
      expect(result.ok, `${name} should be rejected`).toBe(false);
      if (!result.ok) expect(result.error, name).toContain(expected);
    }
  });

  it("has no table entry for a fixture that does not exist", () => {
    for (const name of Object.keys(EXPECTED_ERROR)) expect(files).toContain(name);
  });
});

describe("documents that are not settings", () => {
  it.each([["empty", ""], ["whitespace", "   "], ["an HTML error page", "<!DOCTYPE html><html><body>404 Not Found</body></html>"], ["a JSON array", "[]"], ["null", "null"]])(
    "rejects %s as not valid JSON",
    (_label, text) => {
      const result = validateSettings(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("not valid JSON");
    },
  );
});

describe("tuning ranges and winnability", () => {
  it("names the range in the message", () => {
    const result = validateSettings(withTuning(0, 2.2, 12));
    expect(result).toEqual({ ok: false, error: "settings.tuning.speed: 0 is outside 1 to 20" });
  });

  it.each([
    [1, 1.5, 4],
    [1, 5, 40],
    [2, 2.2, 12],
    [3, 2.2, 12],
  ])("rejects speed %f, jump %f, spacing %f for a jump that stays over an obstacle too briefly", (speed, jump, spacing) => {
    const result = validateSettings(withTuning(speed, jump, spacing));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("settings.tuning.jumpHeight");
  });

  it.each([
    [20, 1.5, 4],
    [20, 1.5, 6],
    [20, 5, 4],
  ])("rejects speed %f, jump %f, spacing %f for spacing too short to land and jump again", (speed, jump, spacing) => {
    const result = validateSettings(withTuning(speed, jump, spacing));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("settings.tuning.obstacleSpacing");
  });

  it("accepts the default tuning", () => {
    expect(validateSettings(withTuning(6, 2.2, 12)).ok).toBe(true);
  });

  it("gives the same message words as the Unity template, and a value that is accepted", () => {
    // The first message is what the Unity player shows for speed 2, jumpHeight 2.2.
    expect(validateSettings(withTuning(2, 2.2, 12))).toEqual({
      ok: false,
      error: "settings.tuning.jumpHeight: 2.2 m is too low to jump an obstacle at 2 m/s with a 200 ms timing margin; use at least 4.8 m or a higher speed",
    });
    const jump = validateSettings(withTuning(3, 2.2, 12));
    expect(!jump.ok && jump.error).toContain("at least 3.1");
    expect(validateSettings(withTuning(3, 3.1, 12)).ok).toBe(true);

    const spacing = validateSettings(withTuning(20, 5, 4));
    expect(spacing).toEqual({
      ok: false,
      error: "settings.tuning.obstacleSpacing: 4 m is too short at 20 m/s, the hero needs room to land and jump again; use at least 27.1 m or a lower speed",
    });
    expect(validateSettings(withTuning(20, 5, 27.1)).ok).toBe(true);
  });
});

describe("text handling", () => {
  it("accepts a UTF-8 byte-order mark and returns the text without it", () => {
    const bom = "﻿";
    const original = fixture("valid.json");
    const result = validateSettings(bom + original);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text.charCodeAt(0)).not.toBe(0xfeff);
      expect(result.text).toBe(original);
    }
  });

  it("is never looser than Unity on a wrongly typed value", () => {
    const base = JSON.parse(fixture("valid.json"));
    base.tuning.speed = "fast";
    const result = validateSettings(JSON.stringify(base));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("speed");
  });
});

describe("rolesNeeded", () => {
  const needed = (text: string) => {
    const result = validateSettings(text);
    if (!result.ok) throw new Error(result.error);
    return rolesNeeded(result.settings);
  };

  it("lists each file once, in the order hero, obstacle, collectible", () => {
    expect(needed(withRoles("hero.glb", "obstacle.glb", "coin.glb"))).toEqual(["hero.glb", "obstacle.glb", "coin.glb"]);
    expect(needed(withRoles("hero.glb", "hero.glb", "coin.glb"))).toEqual(["hero.glb", "coin.glb"]);
  });

  it("returns one name when a single file serves every role", () => {
    expect(needed(withRoles("all.glb", "all.glb", "all.glb"))).toEqual(["all.glb"]);
  });

  it("accepts an upper-case extension", () => {
    expect(needed(withRoles("Hero.GLB", "obstacle.glb", "coin.glb"))).toEqual(["Hero.GLB", "obstacle.glb", "coin.glb"]);
  });
});

// The Unity template decides, in single precision, which of about two million tunings are playable; this validator
// must decide every one the same way, or it would store a run that the player then refuses. The golden file was made
// by Unity (WinnabilityGoldenTests.Regenerate_the_golden_file) and WinnabilityGoldenTests.cs checks it from that side.
describe("winnability agrees with the Unity template on the shared grid", () => {
  const hundredths = (h: number) => `${Math.floor(h / 100)}.${String(h % 100).padStart(2, "0")}`;
  const halves = (d: number) => `${Math.floor(d / 2)}${d % 2 === 0 ? ".0" : ".5"}`;

  it("reproduces the fingerprint in fixtures/settings/winnability-grid.txt", () => {
    const lines = readFileSync(FIXTURES + "winnability-grid.txt", "utf8").split("\n");
    const golden = (key: string) => lines.find((l) => l.startsWith(key + ": "))!.slice(key.length + 2).trim();

    const bits: string[] = [];
    let playable = 0;
    for (let s = 20; s <= 400; s++)
      for (let j = 30; j <= 100; j++)
        for (let d = 8; d <= 80; d++) {
          const ok = winnabilityError(Number(hundredths(s * 5)), Number(hundredths(j * 5)), Number(halves(d))) === null;
          bits.push(ok ? "1" : "0");
          if (ok) playable++;
        }

    expect(bits.length).toBe(Number(golden("points")));
    expect(playable).toBe(Number(golden("accepted")));
    expect(createHash("sha256").update(bits.join("")).digest("hex")).toBe(golden("sha256"));
  });
});
