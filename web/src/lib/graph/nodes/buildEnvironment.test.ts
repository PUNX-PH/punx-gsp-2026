import { describe, expect, it } from "vitest";
import type { BuildEnvironmentInput, BuiltEnvironment, BuilderService } from "@/lib/builder/types";
import { buildEnvironment } from "@/lib/graph/nodes/buildEnvironment";
import { EXECUTORS } from "@/lib/graph/nodes";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, type ExecutorContext, NodeError } from "@/lib/graph/types";

const user = { uid: "alice", email: "alice@punx.ai" };
const derived = {} as DerivedFiles;
const TREE_SHA = "a".repeat(64);
const ROCK_SHA = "b".repeat(64);
const built: BuiltEnvironment = {
  sky: 1,
  field: 2,
  stripe: 4,
  density: "some",
  scenery: [
    { kind: "tree", sha256: TREE_SHA, size: 17_368, triangles: 188 },
    { kind: "rock", sha256: ROCK_SHA, size: 4_000, triangles: 40 },
  ],
  reused: false,
};
const params = (change: Record<string, unknown> = {}) => ({ theme: "a windy meadow", density: "some", ...change });

function context(reply: () => Promise<BuiltEnvironment> = async () => built) {
  const asked: { job: unknown; input: BuildEnvironmentInput }[] = [];
  const builder: BuilderService = {
    async buildModel() {
      throw new Error("not used");
    },
    async buildEnvironment(job, input) {
      asked.push({ job, input });
      return reply();
    },
  };
  const ctx = { user, graphId: "g1", derived, deadline: 55, builder } as unknown as ExecutorContext;
  return { ctx, asked };
}
const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("the Build Environment node", () => {
  it("is registered", () => {
    expect(EXECUTORS["build-environment"]).toBe(buildEnvironment);
  });

  it("asks the builder with the theme and the density, and the sample palette when nothing is wired", async () => {
    const { ctx, asked } = context();
    await buildEnvironment({}, params({ theme: "a windy meadow", density: "lots" }), ctx);

    expect(asked).toEqual([
      {
        job: { user, graphId: "g1", derived, deadline: 55 },
        input: { theme: "a windy meadow", density: "lots", palette: [...SAMPLE_PALETTE] },
      },
    ]);
  });

  it("paints with the palette that is wired", async () => {
    const colors = ["#000000", "#111111", "#222222", "#333333", "#ffffff"];
    const { ctx, asked } = context();
    await buildEnvironment({ palette: { type: "palette", colors } }, params(), ctx);
    expect(asked[0].input.palette).toEqual(colors);
  });

  it("falls back to the sample palette for any color that is not #rrggbb, so the builder always has five real colors", async () => {
    const { ctx, asked } = context();
    await buildEnvironment({ palette: { type: "palette", colors: ["#000000", "red", "", "#12345", "#abcdef"] } }, params(), ctx);
    expect(asked[0].input.palette).toEqual(["#000000", SAMPLE_PALETTE[1], SAMPLE_PALETTE[2], SAMPLE_PALETTE[3], "#abcdef"]);
  });

  it("ignores a wired value that is not a palette", async () => {
    const { ctx, asked } = context();
    await buildEnvironment({ palette: { type: "feel", tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } } }, params(), ctx);
    expect(asked[0].input.palette).toEqual([...SAMPLE_PALETTE]);
  });

  it("gives an environment wire: the picks, the density and each piece with its file", async () => {
    const { ctx } = context();
    const { output } = await buildEnvironment({}, params(), ctx);
    expect(output).toEqual({
      type: "environment",
      sky: 1,
      field: 2,
      stripe: 4,
      density: "some",
      scenery: [
        { kind: "tree", sha256: TREE_SHA },
        { kind: "rock", sha256: ROCK_SHA },
      ],
    });
  });

  it("shows the picks as the colors of the palette it painted with, and the pieces by kind", async () => {
    const colors = ["#000000", "#111111", "#222222", "#333333", "#444444"];
    const { ctx } = context();
    const { result } = await buildEnvironment({ palette: { type: "palette", colors } }, params(), ctx);
    expect(result).toEqual({ sky: "#111111", field: "#222222", stripe: "#444444", density: "some", scenery: ["tree", "rock"], reused: false });
  });

  it("shows the sample palette's colors when none is wired", async () => {
    const { ctx } = context();
    const { result } = await buildEnvironment({}, params(), ctx);
    expect(result).toMatchObject({ sky: SAMPLE_PALETTE[1], field: SAMPLE_PALETTE[2], stripe: SAMPLE_PALETTE[4] });
  });

  it("says when everything was reused", async () => {
    const { ctx } = context(async () => ({ ...built, reused: true }));
    const { result } = await buildEnvironment({}, params(), ctx);
    expect(result).toMatchObject({ reused: true });
  });

  it("passes a NodeError from the builder through unchanged", async () => {
    const original = new NodeError("Build Environment: The Blender service did not answer. Try again.");
    const { ctx } = context(async () => {
      throw original;
    });
    expect(await failure(buildEnvironment({}, params(), ctx))).toBe(original);
  });

  it("does not let the builder's answer be changed by what it hands on", async () => {
    const { ctx } = context();
    const { output } = await buildEnvironment({}, params(), ctx);
    if (output?.type === "environment") output.scenery.pop();
    expect(built.scenery).toHaveLength(2);
  });
});
