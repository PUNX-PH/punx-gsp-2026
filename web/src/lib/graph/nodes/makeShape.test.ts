import { describe, expect, it } from "vitest";
import type { BlenderService, MadeResult } from "@/lib/blender/types";
import { makeShape } from "@/lib/graph/nodes/makeShape";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";

const MADE_SHA = "f".repeat(64);
const user = { uid: "alice", email: "alice@punx.ai" };
const derived = {} as DerivedFiles;
const made: MadeResult = { sha256: MADE_SHA, size: 3_000, trianglesBefore: null, trianglesAfter: 80, reused: true };

function context(reply: () => Promise<MadeResult> = async () => made) {
  const asked: { job: unknown; input: Record<string, unknown> }[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape(job, input) {
      asked.push({ job, input });
      return reply();
    },
  };
  const ctx = { user, graphId: "g1", derived, deadline: 99, blender } as unknown as ExecutorContext;
  return { ctx, asked };
}

describe("the Make Shape node", () => {
  it("makes the shape in the swatch's color from the wired palette and gives the GLB named after the shape", async () => {
    const { ctx, asked } = context();
    const palette: WireValue = { type: "palette", colors: ["#1b1f3b", "#ff6f59", "#abcdef", "#06d6a0", "#ffffff"] };

    const done = await makeShape({ palette }, { shape: "sphere", color: 3 }, ctx);

    expect(asked).toEqual([{ job: { user, graphId: "g1", derived, deadline: 99 }, input: { shape: "sphere", color: "#abcdef" } }]);
    expect(done.output).toEqual({ type: "model", sha256: MADE_SHA, name: "sphere.glb", size: 3_000, format: "glb" });
    expect(done.result).toEqual({ shape: "sphere", color: "#abcdef", trianglesAfter: 80, size: 3_000, reused: true });
  });

  it("uses the sample palette's swatch when no palette is wired", async () => {
    const { ctx, asked } = context();
    await makeShape({}, { shape: "cube", color: 4 }, ctx);
    expect(asked[0].input).toEqual({ shape: "cube", color: SAMPLE_PALETTE[3] });
  });

  it("passes the service's plain sentence through unchanged", async () => {
    const { ctx } = context(async () => {
      throw new NodeError("Make Shape: Blender is busy today. Try again tomorrow.");
    });
    const error = await makeShape({}, { shape: "cube", color: 4 }, ctx).then(() => null, (e: unknown) => e);
    expect(error).toEqual(new NodeError("Make Shape: Blender is busy today. Try again tomorrow."));
  });
});
