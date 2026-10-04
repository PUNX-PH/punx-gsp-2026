import { describe, expect, it } from "vitest";
import { JOB_VERSION, prepareKey, shapeKey } from "@/lib/blender/key";
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
