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

describe("the Game Template node and the role a model was built for", () => {
  const built = (role: "hero" | "obstacle" | "collectible", clips: ("Run" | "Jump" | "Loop")[] = ["Run", "Jump"]) => ({
    type: "model" as const,
    sha256: SHA,
    name: `${role}.glb`,
    size: 100,
    format: "glb" as const,
    role,
    clips,
  });
  const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

  it("refuses a model built for another role, and says which role to set", async () => {
    const wrongHero = await failure(gameTemplate({ hero: built("obstacle") }, { tuning }, ctx));
    expect(wrongHero).toBeInstanceOf(NodeError);
    expect((wrongHero as Error).message).toBe("Game Template: the hero model was built as an obstacle. Set its role to hero.");

    const wrongCollectible = await failure(gameTemplate({ collectible: built("hero") }, { tuning }, ctx));
    expect((wrongCollectible as Error).message).toBe("Game Template: the collectible model was built as a hero. Set its role to collectible.");

    const wrongObstacle = await failure(gameTemplate({ obstacle: built("collectible") }, { tuning }, ctx));
    expect((wrongObstacle as Error).message).toBe("Game Template: the obstacle model was built as a collectible. Set its role to obstacle.");
  });

  it("takes a model built for the role it is plugged into", async () => {
    const { output } = await gameTemplate({ hero: built("hero"), obstacle: built("obstacle", ["Loop"]), collectible: built("collectible", ["Loop"]) }, { tuning }, ctx);
    expect(output).toMatchObject({ type: "settings", models: { hero: { kind: "asset", sha256: SHA }, obstacle: { kind: "asset" }, collectible: { kind: "asset" } } });
  });

  it("takes a model that carries no role, as before (an upload, a prepared model, a shape)", async () => {
    const plain = { type: "model" as const, sha256: SHA, name: "thing.glb", size: 100, format: "glb" as const };
    const { output } = await gameTemplate({ hero: plain, obstacle: plain, collectible: plain }, { tuning }, ctx);
    expect(output?.type).toBe("settings");
  });

  it("takes a hero that was built with no clips", async () => {
    const { output } = await gameTemplate({ hero: built("hero", []) }, { tuning }, ctx);
    expect(output?.type).toBe("settings");
  });
});

describe("the Game Template node and model files that are not GLBs", () => {
  const raw = (format: "fbx" | "obj") => ({ type: "model" as const, sha256: SHA, name: `thing.${format}`, size: 100, format });
  const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

  it.each([
    ["hero", "fbx", "FBX"],
    ["obstacle", "obj", "OBJ"],
    ["collectible", "fbx", "FBX"],
  ] as const)("refuses a raw %s model that is a %s file, and says what to do", async (role, format, shown) => {
    const error = await failure(gameTemplate({ [role]: raw(format) }, { tuning }, ctx));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(`Game Template: the ${role} model is an ${shown} file. Put a Prepare Model step after it.`);
  });

  it("still takes a GLB in every role", async () => {
    const glb = { type: "model" as const, sha256: SHA, name: "thing.glb", size: 100, format: "glb" as const };
    const { output } = await gameTemplate({ hero: glb, obstacle: glb, collectible: glb }, { tuning }, ctx);
    expect(output).toMatchObject({ type: "settings", models: { hero: { kind: "asset", sha256: SHA }, obstacle: { kind: "asset", sha256: SHA }, collectible: { kind: "asset", sha256: SHA } } });
  });
});

describe("the Game Template node and an environment", () => {
  const SHA_A = "a".repeat(64);
  const SHA_B = "b".repeat(64);
  const SHA_C = "c".repeat(64);
  const SHA_D = "d".repeat(64);
  const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);
  const world =(scenery: { kind: "tree" | "pine" | "rock" | "cactus" | "windmill" | "lamp"; sha256: string }[]) =>
    ({ type: "environment" as const, sky: 0, field: 3, stripe: 4, density: "some" as const, scenery });

  it("without an environment makes exactly the settings text it always made, and a wire with no scenery", async () => {
    const { output } = await gameTemplate({}, { tuning }, ctx);
    const before = JSON.stringify({ schemaVersion: 1, template: "runner", palette: [...SAMPLE_PALETTE], roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" }, tuning });
    expect(output?.type === "settings" && output.settingsText).toBe(before);
    expect(output?.type === "settings" && "scenery" in output).toBe(false);
  });

  it("with an environment of two pieces adds the environment to the settings, which pass the template's own check, and names the files in order", async () => {
    const { output } = await gameTemplate({ environment: world([{ kind: "tree", sha256: SHA_A }, { kind: "rock", sha256: SHA_B }]) }, { tuning }, ctx);

    expect(output?.type).toBe("settings");
    if (output?.type !== "settings") return;
    const checked = validateSettings(output.settingsText);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.settings.environment).toEqual({ sky: 0, field: 3, stripe: 4, density: "some", scenery: ["scenery1.glb", "scenery2.glb"] });
    expect(output.scenery).toEqual([
      { file: "scenery1.glb", sha256: SHA_A },
      { file: "scenery2.glb", sha256: SHA_B },
    ]);
  });

  it("puts the environment after the tuning, so the rest of the text is what it was", async () => {
    const { output } = await gameTemplate({ environment: world([]) }, { tuning }, ctx);
    const before = JSON.stringify({ schemaVersion: 1, template: "runner", palette: [...SAMPLE_PALETTE], roles: { hero: "hero.glb", obstacle: "obstacle.glb", collectible: "collectible.glb" }, tuning });
    expect(output?.type === "settings" && output.settingsText.startsWith(before.slice(0, -1) + ",\"environment\":")).toBe(true);
  });

  it("takes an environment with no scenery: the field and the stripes only", async () => {
    const { output } = await gameTemplate({ environment: world([]) }, { tuning }, ctx);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).environment).toEqual({ sky: 0, field: 3, stripe: 4, density: "some", scenery: [] });
    expect(output?.type === "settings" && output.scenery).toEqual([]);
  });

  it("uses at most three scenery pieces, the first three", async () => {
    const four = world([{ kind: "tree", sha256: SHA_A }, { kind: "pine", sha256: SHA_B }, { kind: "rock", sha256: SHA_C }, { kind: "lamp", sha256: SHA_D }]);
    const { output } = await gameTemplate({ environment: four }, { tuning }, ctx);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).environment.scenery).toEqual(["scenery1.glb", "scenery2.glb", "scenery3.glb"]);
    expect(output?.type === "settings" && output.scenery?.map((s) => s.sha256)).toEqual([SHA_A, SHA_B, SHA_C]);
  });

  it("carries the density and the palette picks as they came", async () => {
    const lots = { ...world([{ kind: "windmill", sha256: SHA_A }]), sky: 1, field: 2, stripe: 0, density: "lots" as const };
    const { output } = await gameTemplate({ environment: lots }, { tuning }, ctx);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).environment).toMatchObject({ sky: 1, field: 2, stripe: 0, density: "lots" });
  });

  it("refuses a palette pick that is not a palette index, with the template's own words, under its own name", async () => {
    const bad = { ...world([]), sky: 5 };
    const error = await failure(gameTemplate({ environment: bad }, { tuning }, ctx));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Game Template: settings.environment.sky: 5 is not a palette index (0 to 4)");
  });

  it("ignores a connected value that is not an environment", async () => {
    const { output } = await gameTemplate({ environment: { type: "palette", colors: [...SAMPLE_PALETTE] } }, { tuning }, ctx);
    expect(output?.type === "settings" && JSON.parse(output.settingsText).environment).toBeUndefined();
  });

  it("its result is still just the tuning", async () => {
    const { result } = await gameTemplate({ environment: world([{ kind: "tree", sha256: SHA_A }]) }, { tuning }, ctx);
    expect(result).toEqual({ tuning });
  });
});
