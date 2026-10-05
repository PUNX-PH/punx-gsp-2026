import { describe, expect, it } from "vitest";
import type { BuildModelInput, BuiltModel, BuilderService } from "@/lib/builder/types";
import { buildModel } from "@/lib/graph/nodes/buildModel";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";

const user = { uid: "alice", email: "alice@punx.ai" };
const derived = {} as DerivedFiles;
const PICTURE_SHA = "a".repeat(64);
const BUILT_SHA = "b".repeat(64);
const built: BuiltModel = {
  sha256: BUILT_SHA,
  size: 24_824,
  kind: "biped",
  parts: 15,
  triangles: 180,
  clips: ["Run", "Jump"],
  summary: "A blocky two-legged character.",
  skipped: [{ clip: "Run", joint: "tail_1" }],
  reused: false,
};
const params = (change: Record<string, unknown> = {}) => ({ role: "hero", kind: "biped", description: "a fox", run: "sprint", jump: "", loop: "", ...change });
const picture: WireValue = { type: "image", sha256: PICTURE_SHA, name: "p.png", width: 10, height: 10 };

function context(files: Record<string, Uint8Array> = { [PICTURE_SHA]: new Uint8Array([1, 2, 3]) }, reply: () => Promise<BuiltModel> = async () => built) {
  const asked: { job: unknown; input: BuildModelInput }[] = [];
  const builder: BuilderService = {
    async buildModel(job, input) {
      asked.push({ job, input });
      return reply();
    },
  };
  const ctx = { user, graphId: "g1", derived, deadline: 55, builder, readAsset: async (sha: string) => files[sha] ?? null } as unknown as ExecutorContext;
  return { ctx, asked };
}
const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("the Build Model node", () => {
  it("asks the builder with the settings, no picture, and the sample palette when nothing is wired", async () => {
    const { ctx, asked } = context();
    await buildModel({}, params(), ctx);

    expect(asked).toEqual([
      {
        job: { user, graphId: "g1", derived, deadline: 55 },
        input: { role: "hero", kind: "biped", description: "a fox", motions: { run: "sprint", jump: "", loop: "" }, picture: null, palette: [...SAMPLE_PALETTE] },
      },
    ]);
  });

  it("gives the picture's bytes and sha when an image is wired, and the wired palette with a bad entry replaced by the sample's", async () => {
    const { ctx, asked } = context();
    const palette: WireValue = { type: "palette", colors: ["#111111", "red", "#333333", "", "#555555"] };

    await buildModel({ image: picture, palette }, params(), ctx);

    expect(asked[0].input.picture).toEqual({ sha256: PICTURE_SHA, bytes: new Uint8Array([1, 2, 3]) });
    expect(asked[0].input.palette).toEqual(["#111111", SAMPLE_PALETTE[1], "#333333", SAMPLE_PALETTE[3], "#555555"]);
  });

  it("hands on a model wire with its role and clips, and a result for the card", async () => {
    const { ctx } = context();
    const done = await buildModel({}, params({ role: "hero" }), ctx);

    expect(done.output).toEqual({ type: "model", sha256: BUILT_SHA, name: "biped.glb", size: 24_824, format: "glb", role: "hero", clips: ["Run", "Jump"] });
    expect(done.result).toEqual({
      role: "hero",
      kind: "biped",
      parts: 15,
      triangles: 180,
      size: 24_824,
      clips: ["Run", "Jump"],
      summary: "A blocky two-legged character.",
      skipped: [{ clip: "Run", joint: "tail_1" }],
      reused: false,
    });
  });

  it("names the file after the kind that was built, whatever the settings said", async () => {
    const { ctx } = context(undefined, async () => ({ ...built, kind: "vehicle", clips: ["Loop"] }));
    const done = await buildModel({}, params({ kind: "auto", role: "obstacle" }), ctx);
    expect(done.output).toMatchObject({ name: "vehicle.glb", role: "obstacle", clips: ["Loop"] });
  });

  it("says the picture is missing, and asks nothing, when its file is gone", async () => {
    const { ctx, asked } = context({});
    const error = await failure(buildModel({ image: picture }, params(), ctx));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Build Model: the picture is missing. Choose it again.");
    expect(asked).toHaveLength(0);
  });

  it("lets a NodeError from the builder through unchanged", async () => {
    const original = new NodeError("Build Model: The AI service did not answer. Try again.");
    const { ctx } = context(undefined, async () => {
      throw original;
    });
    expect(await failure(buildModel({}, params(), ctx))).toBe(original);
  });

  it("ignores a wire of the wrong type on a port", async () => {
    const { ctx, asked } = context();
    await buildModel({ palette: picture, image: { type: "palette", colors: [...SAMPLE_PALETTE] } }, params(), ctx);
    expect(asked[0].input.picture).toBeNull();
    expect(asked[0].input.palette).toEqual([...SAMPLE_PALETTE]);
  });
});
