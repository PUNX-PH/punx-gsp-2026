import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildKey, canonicalJson, hashKey, JOB_VERSION, prepareKey, shapeKey } from "@/lib/blender/key";
import type { BuildBody } from "@/lib/builder/recipes";
import { sha256Hex } from "@/lib/runs/service";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const sha = (value: unknown) => sha256Hex(new TextEncoder().encode(JSON.stringify(value)));
const base = { graphId: "g1", inputSha: SHA, triangles: 2000, color: null as string | null };

describe("prepareKey", () => {
  it("is the SHA-256 of the version, the kind, the graph, the input, the budget and the color, in that order", async () => {
    expect(JOB_VERSION).toBe(1);
    expect(await prepareKey(base)).toBe(await sha([1, "prepare", "g1", SHA, 2000, null]));
    expect(await prepareKey({ ...base, color: "#ff6f59" })).toBe(await sha([1, "prepare", "g1", SHA, 2000, "#ff6f59"]));
  });

  it("is the same for the same job, and different when any one thing differs", async () => {
    const key = await prepareKey(base);
    expect(await prepareKey({ ...base })).toBe(key);
    for (const changed of [
      { ...base, graphId: "g2" },
      { ...base, inputSha: OTHER },
      { ...base, triangles: 2001 },
      { ...base, color: "#aaaaaa" },
    ]) {
      expect(await prepareKey(changed)).not.toBe(key);
    }
  });

  it("tells the model's own colors (null) from a color", async () => {
    expect(await prepareKey({ ...base, color: null })).not.toBe(await prepareKey({ ...base, color: "null" }));
  });

  it("cannot be made to run one field into the next", async () => {
    expect(await prepareKey({ ...base, graphId: "g1" + SHA, inputSha: "" })).not.toBe(await prepareKey({ ...base, graphId: "g1", inputSha: SHA }));
  });
});

describe("shapeKey", () => {
  const shape = { graphId: "g1", shape: "sphere" as const, color: "#06d6a0" };

  it("is the SHA-256 of the version, the kind, the graph, the shape and the color", async () => {
    expect(await shapeKey(shape)).toBe(await sha([1, "shape", "g1", "sphere", "#06d6a0"]));
  });

  it("differs by graph, shape and color", async () => {
    const key = await shapeKey(shape);
    expect(await shapeKey({ ...shape, graphId: "g2" })).not.toBe(key);
    expect(await shapeKey({ ...shape, shape: "cube" })).not.toBe(key);
    expect(await shapeKey({ ...shape, color: "#06d6a1" })).not.toBe(key);
  });

  it("is never the key of a prepare job, whatever the values", async () => {
    expect(await shapeKey({ graphId: "g1", shape: "cube", color: "#000000" })).not.toBe(await prepareKey({ graphId: "g1", inputSha: "cube", triangles: 0, color: "#000000" }));
  });
});

describe("canonicalJson", () => {
  it("sorts object keys at every level and keeps arrays in order", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { f: 1, e: 0 }], c: null } })).toBe('{"a":{"c":null,"d":[2,{"e":0,"f":1}]},"b":1}');
  });

  it("writes strings, numbers and booleans as JSON does, and leaves out what JSON leaves out", () => {
    expect(canonicalJson(["a\"b", -0.5, 1e21, true, null])).toBe(JSON.stringify(["a\"b", -0.5, 1e21, true, null]));
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(canonicalJson([undefined])).toBe("[null]");
  });
});

describe("hashKey", () => {
  it("is the SHA-256 of the canonical text, which for a list of plain values is what prepare and shape keys always were", async () => {
    expect(await hashKey([1, "x", null])).toBe(await sha([1, "x", null]));
  });
});

describe("buildKey", () => {
  const body = JSON.parse(readFileSync(new URL("../../../../blender-worker/fixtures/recipes/biped-default.json", import.meta.url), "utf8")) as BuildBody;
  const reversed = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(reversed)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]))
        : value;

  it("is the SHA-256 of the canonical text of the version, the kind, the graph, the recipe, the motions and the palette", async () => {
    expect(await buildKey({ graphId: "g1", body })).toBe(
      await sha256Hex(new TextEncoder().encode(canonicalJson([JOB_VERSION, "build", "g1", body.recipe, body.motions, body.palette]))),
    );
  });

  it("is the same whatever order the keys come in, at every level (Claude may write them in any order)", async () => {
    expect(await buildKey({ graphId: "g1", body: reversed(body) as BuildBody })).toBe(await buildKey({ graphId: "g1", body }));
  });

  it("changes with the graph, a build number, a track and a palette color, each alone", async () => {
    const key = await buildKey({ graphId: "g1", body });
    const edit = (change: (copy: BuildBody) => void): BuildBody => {
      const copy = structuredClone(body);
      change(copy);
      return copy;
    };
    expect(await buildKey({ graphId: "g2", body })).not.toBe(key);
    expect(await buildKey({ graphId: "g1", body: edit((b) => { b.recipe.build.headSize = 0.51; }) })).not.toBe(key);
    expect(await buildKey({ graphId: "g1", body: edit((b) => { b.motions.motions.run!.tracks[0].amplitude = 36; }) })).not.toBe(key);
    expect(await buildKey({ graphId: "g1", body: edit((b) => { b.palette[2] = "#ffd167"; }) })).not.toBe(key);
  });

  it("is never the key of a prepare or a shape job", async () => {
    const key = await buildKey({ graphId: "g1", body });
    expect(key).not.toBe(await prepareKey({ graphId: "g1", inputSha: SHA, triangles: 2000, color: null }));
    expect(key).not.toBe(await shapeKey({ graphId: "g1", shape: "cube", color: "#000000" }));
  });
});
