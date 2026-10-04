import { describe, expect, it } from "vitest";
import type { BlenderService, MadeResult } from "@/lib/blender/types";
import { prepareModel } from "@/lib/graph/nodes/prepareModel";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";

const SHA = "e".repeat(64);
const MADE_SHA = "f".repeat(64);
const user = { uid: "alice", email: "alice@punx.ai" };
const derived = {} as DerivedFiles;
const model: WireValue = { type: "model", sha256: SHA, name: "robot.fbx", size: 4000, format: "fbx" };
const made: MadeResult = { sha256: MADE_SHA, size: 41_000, trianglesBefore: 9400, trianglesAfter: 2000, reused: false };

/** A context whose Blender service remembers what it was asked. */
function context(files: Record<string, Uint8Array> = { [SHA]: new Uint8Array([7, 7, 7]) }, reply: () => Promise<MadeResult> = async () => made) {
  const asked: { job: unknown; input: Record<string, unknown> }[] = [];
  const blender: BlenderService = {
    async prepare(job, input) {
      asked.push({ job, input });
      return reply();
    },
    async shape() {
      throw new Error("not used");
    },
  };
  const ctx = { user, graphId: "g1", derived, deadline: 123_456, blender, readAsset: async (sha: string) => files[sha] ?? null } as unknown as ExecutorContext;
  return { ctx, asked };
}

describe("the Prepare Model node", () => {
  it("prepares the model with the settings, a color from the wired palette, and hands on the new GLB under the old name", async () => {
    const { ctx, asked } = context();
    const palette: WireValue = { type: "palette", colors: ["#1b1f3b", "#123456", "#ffd166", "#06d6a0", "#ffffff"] };

    const done = await prepareModel({ model, palette }, { triangles: 1500, color: 2 }, ctx);

    expect(asked).toEqual([
      {
        job: { user, graphId: "g1", derived, deadline: 123_456 },
        input: { sha256: SHA, bytes: new Uint8Array([7, 7, 7]), format: "fbx", triangles: 1500, color: "#123456" },
      },
    ]);
    expect(done.output).toEqual({ type: "model", sha256: MADE_SHA, name: "robot.glb", size: 41_000, format: "glb" });
    expect(done.outputs).toBeUndefined();
    expect(done.result).toEqual({ trianglesBefore: 9400, trianglesAfter: 2000, size: 41_000, color: "#123456", reused: false });
  });

  it("uses the sample palette's swatch when no palette is wired, and null for the model's own colors", async () => {
    const { ctx, asked } = context();
    await prepareModel({ model }, { triangles: 2000, color: 4 }, ctx);
    await prepareModel({ model }, { triangles: 2000, color: "original" }, ctx);
    expect(asked.map((a) => a.input.color)).toEqual([SAMPLE_PALETTE[3], null]);
  });

  it("makes the same call when a palette change leaves the picked color as it was", async () => {
    const { ctx, asked } = context();
    const a: WireValue = { type: "palette", colors: ["#111111", "#123456", "#222222", "#333333", "#444444"] };
    const b: WireValue = { type: "palette", colors: ["#aaaaaa", "#123456", "#bbbbbb", "#cccccc", "#dddddd"] };
    await prepareModel({ model, palette: a }, { triangles: 2000, color: 2 }, ctx);
    await prepareModel({ model, palette: b }, { triangles: 2000, color: 2 }, ctx);
    expect(asked[0].input).toEqual(asked[1].input);
  });

  it("names a file with no extension, and one with several dots, sensibly", async () => {
    for (const [name, expected] of [["robot", "robot.glb"], ["my.robot.v2.obj", "my.robot.v2.glb"], [".hidden", ".hidden.glb"]] as const) {
      const { ctx } = context();
      const done = await prepareModel({ model: { ...model, name } }, { triangles: 2000, color: "original" }, ctx);
      expect(done.output).toMatchObject({ name: expected });
    }
  });

  it("says the model is missing when its file is gone", async () => {
    const { ctx } = context({});
    const error = await prepareModel({ model }, { triangles: 2000, color: "original" }, ctx).then(() => null, (e: unknown) => e);
    expect(error).toEqual(new NodeError("Prepare Model: the model is missing. Choose it again."));
  });

  it("passes the service's plain sentence through unchanged", async () => {
    const { ctx } = context(undefined, async () => {
      throw new NodeError("Prepare Model: This file has no 3D shape in it.");
    });
    const error = await prepareModel({ model }, { triangles: 2000, color: "original" }, ctx).then(() => null, (e: unknown) => e);
    expect(error).toEqual(new NodeError("Prepare Model: This file has no 3D shape in it."));
  });
});
