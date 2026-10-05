import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { filesNeeded, minPlayableSpacing, rolesNeeded, validateSettings, winnabilityError } from "@/lib/settings";

// web/src/lib -> repo root is three levels up.
const FIXTURES = fileURLToPath(new URL("../../../fixtures/settings/", import.meta.url));
const fixture = (name: string) => readFileSync(FIXTURES + name, "utf8");

// What each invalid fixture's error must contain: the same table as the Unity template's SettingsParserTests.
const EXPECTED_ERROR: Record<string, string> = {
  "invalid-environment-bad-index.json": "environment.sky",
  "invalid-environment-density.json": "environment.density",
  "invalid-environment-four-files.json": "environment.scenery",
  "invalid-environment-not-glb.json": "environment.scenery",
  "invalid-environment-path.json": "environment.scenery",
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

describe("the environment", () => {
  const withEnvironment = (change: (environment: Record<string, unknown>) => void) => {
    const base = JSON.parse(fixture("valid-environment.json"));
    change(base.environment);
    return JSON.stringify(base);
  };

  it("says what is wrong, in the words the Unity template uses", () => {
    expect(validateSettings(fixture("invalid-environment-bad-index.json"))).toEqual({
      ok: false,
      error: "settings.environment.sky: 5 is not a palette index (0 to 4)",
    });
    expect(validateSettings(fixture("invalid-environment-density.json"))).toEqual({
      ok: false,
      error: 'settings.environment.density: "many" must be few, some or lots',
    });
    expect(validateSettings(fixture("invalid-environment-four-files.json"))).toEqual({
      ok: false,
      error: "settings.environment.scenery: at most 3 files, found 4",
    });
    expect(validateSettings(fixture("invalid-environment-path.json"))).toEqual({
      ok: false,
      error: 'settings.environment.scenery[0]: "../scenery1.glb" must be a plain file name like scenery1.glb (letters, digits, - and _ only)',
    });
  });

  it("checks field and stripe like sky, in that order", () => {
    const both = withEnvironment((e) => {
      e.field = -1;
      e.stripe = 9;
    });
    expect(validateSettings(both)).toEqual({ ok: false, error: "settings.environment.field: -1 is not a palette index (0 to 4)" });
    const stripe = withEnvironment((e) => {
      e.stripe = 9;
    });
    expect(validateSettings(stripe)).toEqual({ ok: false, error: "settings.environment.stripe: 9 is not a palette index (0 to 4)" });
  });

  it("refuses what is not a whole palette index, and an environment that is not an object (web only)", () => {
    for (const sky of [2.5, "2", null, Number.NaN]) {
      const result = validateSettings(
        withEnvironment((e) => {
          e.sky = sky;
        }),
      );
      expect(result.ok, String(sky)).toBe(false);
      if (!result.ok) expect(result.error).toContain("settings.environment.sky");
    }
    for (const environment of [null, 3, "sky", [], true]) {
      const base = JSON.parse(fixture("valid.json"));
      base.environment = environment;
      expect(validateSettings(JSON.stringify(base))).toEqual({ ok: false, error: "settings.environment: must be an object" });
    }
  });

  it("refuses scenery that is not a list of file names", () => {
    for (const scenery of ["scenery1.glb", null, [1], [null]]) {
      const result = validateSettings(
        withEnvironment((e) => {
          e.scenery = scenery;
        }),
      );
      expect(result.ok, JSON.stringify(scenery)).toBe(false);
      if (!result.ok) expect(result.error).toContain("settings.environment.scenery");
    }
  });

  it("is checked after the tuning, and only when the key is there", () => {
    const base = JSON.parse(fixture("valid-environment.json"));
    base.tuning.speed = 0;
    base.environment.sky = 5;
    const result = validateSettings(JSON.stringify(base));
    expect(!result.ok && result.error).toContain("settings.tuning.speed");
    expect(validateSettings(fixture("valid.json")).ok).toBe(true);
  });
});

describe("filesNeeded", () => {
  const needed = (text: string) => {
    const result = validateSettings(text);
    if (!result.ok) throw new Error(result.error);
    return filesNeeded(result.settings);
  };

  it("lists the role files and then the scenery files, each once", () => {
    expect(needed(fixture("valid-environment.json"))).toEqual(["hero.glb", "obstacle.glb", "coin.glb", "scenery1.glb", "scenery2.glb", "scenery3.glb"]);
    expect(needed(fixture("valid-environment-no-scenery.json"))).toEqual(["hero.glb", "obstacle.glb", "coin.glb"]);
    const repeated = JSON.parse(fixture("valid-environment.json"));
    repeated.environment.scenery = ["hero.glb", "scenery1.glb", "scenery1.glb"];
    expect(needed(JSON.stringify(repeated))).toEqual(["hero.glb", "obstacle.glb", "coin.glb", "scenery1.glb"]);
  });

  it("is rolesNeeded for settings from before the environment existed", () => {
    expect(needed(fixture("valid.json"))).toEqual(rolesNeeded(JSON.parse(fixture("valid.json"))));
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

describe("minPlayableSpacing (the smallest obstacle spacing the winnability rule accepts)", () => {
  const speeds = [1, 2.5, 4, 6, 8, 12, 16, 20];
  const jumps = [2.2, 2.5, 3, 3.5, 4, 5];

  it("is playable, and 0.1 m less is not, wherever the jump is high enough for the speed", () => {
    let tried = 0;
    for (const speed of speeds)
      for (const jump of jumps) {
        if (winnabilityError(speed, jump, 1000) !== null) continue; // the jump itself is too low: spacing cannot help
        tried++;
        const spacing = minPlayableSpacing(speed, jump);
        expect(winnabilityError(speed, jump, spacing), `${speed} m/s, ${jump} m`).toBeNull();
        expect(winnabilityError(speed, jump, Number((spacing - 0.1).toFixed(1))), `${speed} m/s, ${jump} m, less`).not.toBeNull();
      }
    expect(tried).toBeGreaterThan(20); // the grid really exercises the rule
  });

  it("grows with the speed, and with the jump", () => {
    expect(minPlayableSpacing(12, 3)).toBeGreaterThan(minPlayableSpacing(6, 3));
    expect(minPlayableSpacing(6, 4)).toBeGreaterThan(minPlayableSpacing(6, 3));
  });
});

describe("minPlayableSpacing on every one-decimal speed (the check compares a float, as Unity reads it)", () => {
  const jumps = [2.2, 2.4, 2.6, 3, 3.5, 4, 5];

  it("is playable at every speed from 1 to 20 in steps of 0.1, for each jump height where spacing can help", () => {
    const failures: string[] = [];
    let tried = 0;
    for (let tenths = 10; tenths <= 200; tenths++) {
      const speed = tenths / 10;
      for (const jump of jumps) {
        if (winnabilityError(speed, jump, 1000) !== null) continue; // the jump itself is too low for this speed
        tried++;
        const spacing = minPlayableSpacing(speed, jump);
        if (winnabilityError(speed, jump, spacing) !== null) failures.push(`${speed} m/s, ${jump} m -> ${spacing}`);
        // And it is the smallest: one step less is not playable.
        if (winnabilityError(speed, jump, Number((spacing - 0.1).toFixed(1))) === null) failures.push(`${speed} m/s, ${jump} m -> ${spacing} is not the smallest`);
      }
    }
    expect(tried).toBeGreaterThan(500);
    expect(failures).toEqual([]);
  });
});
