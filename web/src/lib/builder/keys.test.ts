import { describe, expect, it } from "vitest";
import { hashKey } from "@/lib/blender/key";
import { designKey, environmentKey, motionKey, RECIPE_VERSION } from "@/lib/builder/keys";

const design: Parameters<typeof designKey>[0] = { model: "claude-sonnet-5-5", uid: "alice", description: "a fox in a scarf", kind: "auto", role: "hero", pictureSha: null };
const motion: Parameters<typeof motionKey>[0] = { model: "claude-sonnet-5-5", uid: "alice", kind: "biped", joints: ["hips", "thigh_l"], texts: { run: "gallops", jump: "" } };
const environment: Parameters<typeof environmentKey>[0] = { model: "claude-sonnet-5-5", uid: "alice", theme: "a snowy night" };

describe("the recipe version", () => {
  it("is 1", () => expect(RECIPE_VERSION).toBe(1));
});

describe("designKey", () => {
  it("is the hash of the version, the word design, the model, the person, the description, the kind setting, the role and the picture", async () => {
    expect(await designKey(design)).toBe(await hashKey([RECIPE_VERSION, "design", "claude-sonnet-5-5", "alice", "a fox in a scarf", "auto", "hero", null]));
  });

  it.each<[string, Partial<Parameters<typeof designKey>[0]>]>([
    ["the model", { model: "claude-opus-5-5" }],
    ["the person", { uid: "bob" }],
    ["the description", { description: "a fox in a hat" }],
    ["the kind setting", { kind: "biped" }],
    ["the role", { role: "obstacle" }],
    ["the picture", { pictureSha: "a".repeat(64) }],
  ])("changes with %s", async (_label, change) => {
    expect(await designKey({ ...design, ...change })).not.toBe(await designKey(design));
  });

  it("cannot be fooled by text that runs one field into the next", async () => {
    expect(await designKey({ ...design, uid: "a", description: "bc" })).not.toBe(await designKey({ ...design, uid: "ab", description: "c" }));
  });
});

describe("motionKey", () => {
  it("is the hash of the version, the word motion, the model, the person, the kind, the joints and the texts", async () => {
    expect(await motionKey(motion)).toBe(await hashKey([RECIPE_VERSION, "motion", "claude-sonnet-5-5", "alice", "biped", ["hips", "thigh_l"], { run: "gallops", jump: "" }]));
  });

  it.each<[string, Partial<Parameters<typeof motionKey>[0]>]>([
    ["the model", { model: "claude-opus-5-5" }],
    ["the person", { uid: "bob" }],
    ["the kind", { kind: "blob" }],
    ["the joints (a tail adds some)", { joints: ["hips", "thigh_l", "tail_1", "tail_2"] }],
    ["the order of the joints", { joints: ["thigh_l", "hips"] }],
    ["a text", { texts: { run: "trots", jump: "" } }],
    ["a text moving to another clip", { texts: { run: "", jump: "gallops" } }],
  ])("changes with %s", async (_label, change) => {
    expect(await motionKey({ ...motion, ...change })).not.toBe(await motionKey(motion));
  });

  it("does not care in what order the clips' texts were written", async () => {
    expect(await motionKey({ ...motion, texts: { jump: "", run: "gallops" } })).toBe(await motionKey(motion));
  });
});

describe("environmentKey", () => {
  it("is the hash of the version, the word environment, the model, the person and the theme", async () => {
    expect(await environmentKey(environment)).toBe(await hashKey([RECIPE_VERSION, "environment", "claude-sonnet-5-5", "alice", "a snowy night"]));
  });

  it.each<[string, Partial<Parameters<typeof environmentKey>[0]>]>([
    ["the model", { model: "claude-opus-5-5" }],
    ["the person", { uid: "bob" }],
    ["the theme", { theme: "a desert" }],
  ])("changes with %s", async (_label, change) => {
    expect(await environmentKey({ ...environment, ...change })).not.toBe(await environmentKey(environment));
  });
});

describe("the three kinds of key", () => {
  it("never collide for look-alike inputs, because the word for the kind of answer is in each", async () => {
    const same = "x";
    const keys = [
      await designKey({ ...design, description: same }),
      await motionKey({ ...motion, texts: { run: same } }),
      await environmentKey({ ...environment, theme: same }),
    ];
    expect(new Set(keys).size).toBe(3);
    for (const key of keys) expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
