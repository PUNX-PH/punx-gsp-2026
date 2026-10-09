import { describe, expect, it } from "vitest";
import type { BlenderJob } from "@/lib/blender/types";
import { addChoices } from "@/lib/canvas/addMenu";
import type { BuildSceneryInput, BuiltModel, BuilderService } from "@/lib/builder/types";
import { buildWorld } from "@/lib/graph/nodes/buildWorld";
import { NODE_SPECS } from "@/lib/graph/registry";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, type ExecutorContext, NodeError } from "@/lib/graph/types";

const user = { uid: "alice", email: "alice@punx.ai" };
const derived = {} as DerivedFiles;
const piece = (name: string, withPhone = true): BuiltModel => ({
  sha256: name.padEnd(64, "a").slice(0, 64),
  size: 100,
  kind: "freeform",
  parts: 4,
  triangles: 500,
  clips: [],
  summary: name,
  skipped: [],
  reused: false,
  ...(withPhone ? { mobile: { sha256: ("m" + name).padEnd(64, "b").slice(0, 64), size: 50, triangles: 200 } } : {}),
});

function context(reply: (input: BuildSceneryInput) => Promise<BuiltModel>) {
  const asked: { job: BlenderJob; input: BuildSceneryInput }[] = [];
  const builder: BuilderService = {
    async buildModel() {
      throw new Error("not used");
    },
    async buildScenery(job, input) {
      asked.push({ job, input });
      return reply(input);
    },
    async buildEnvironment() {
      throw new Error("not used");
    },
  };
  return { ctx: { user, graphId: "g1", derived, deadline: 55, builder } as unknown as ExecutorContext, asked };
}

const params = (extra: Record<string, unknown> = {}) => ({ sky: 0, ground: 3, scenery: ["a snowy pine", "a neon sign"], ...extra });
const paletteWire = { palette: { type: "palette" as const, colors: [...SAMPLE_PALETTE] } };

describe("the Build World node", () => {
  it("makes each piece of scenery from its words in the game's style and hands on an environment with the sky, the ground and the pieces", async () => {
    const { ctx, asked } = context(async (input) => piece(input.description.split(" ").pop()!));
    const done = await buildWorld(paletteWire, params({ style: "cartoon" }), ctx);
    expect(asked.map((a) => a.input.description)).toEqual(["a snowy pine", "a neon sign"]);
    expect(asked[0].input).toMatchObject({ style: "cartoon" });
    expect(asked[0].job).toMatchObject({ user, graphId: "g1", deadline: 55 });
    expect(done.output).toMatchObject({ type: "environment", sky: 0, field: 3, stripe: 3, density: "lots" });
    if (done.output?.type !== "environment") throw new Error("expected an environment");
    expect(done.output.scenery).toHaveLength(2);
    expect(done.output.scenery[0]).toMatchObject({ kind: "custom", mobile: expect.stringMatching(/^m/) });
    expect(done.result).toMatchObject({ sky: SAMPLE_PALETTE[0], field: SAMPLE_PALETTE[3], skipped: 0, triangles: 1000, reused: false });
  });

  it("leaves a piece that cannot be built out and counts it, and still tries the next", async () => {
    let n = 0;
    const { ctx, asked } = context(async (input) => {
      n += 1;
      if (n === 1) throw new NodeError("Build World: Blender is busy today. Try again tomorrow.");
      return piece(input.description);
    });
    const done = await buildWorld(paletteWire, params(), ctx);
    expect(asked).toHaveLength(2);
    if (done.output?.type !== "environment") throw new Error("expected an environment");
    expect(done.output.scenery).toHaveLength(1);
    expect(done.result).toMatchObject({ skipped: 1, reused: false });
  });

  it("is still a world with no scenery: a sky and a ground", async () => {
    const { ctx, asked } = context(async () => piece("x"));
    const done = await buildWorld({}, params({ scenery: [] }), ctx);
    expect(asked).toHaveLength(0);
    expect(done.output).toMatchObject({ type: "environment", scenery: [] });
  });

  it("does not hide a failure that is not the step's own sentence", async () => {
    const { ctx } = context(async () => {
      throw new TypeError("boom");
    });
    await expect(buildWorld({}, params(), ctx)).rejects.toThrow("boom");
  });

  it("works without a phone variant, and says it was reused only when every piece was", async () => {
    const { ctx } = context(async (input) => ({ ...piece(input.description, false), reused: true }));
    const done = await buildWorld({}, params(), ctx);
    if (done.output?.type !== "environment") throw new Error("expected an environment");
    expect(done.output.scenery.every((s) => s.mobile === undefined)).toBe(true);
    expect(done.result).toMatchObject({ reused: true });
  });
});

describe("the Build World settings", () => {
  const check = NODE_SPECS["build-world"].shapeProblem;

  it("accepts what the site makes", () => {
    expect(check(params())).toBeNull();
    expect(check(params({ style: "flat", soft: true }))).toBeNull();
    expect(check(params({ scenery: [] }))).toBeNull();
  });

  it("refuses an unknown setting, a bad slot, too much scenery, empty or long words, an unknown style", () => {
    expect(check(params({ theme: "x" }))).toMatch(/only settings a Build World step has/);
    expect(check(params({ sky: 5 }))).toMatch(/sky must be a whole number/);
    expect(check(params({ ground: 1.5 }))).toMatch(/ground must be a whole number/);
    expect(check(params({ scenery: ["a", "b", "c", "d", "e"] }))).toMatch(/at most 4/);
    expect(check(params({ scenery: ["  "] }))).toMatch(/needs words/);
    expect(check(params({ scenery: [5] }))).toMatch(/needs words/);
    expect(check(params({ scenery: ["x".repeat(301)] }))).toMatch(/longer than 300/);
    expect(check(params({ scenery: "a pine" }))).toMatch(/list/);
    expect(check(params({ style: "photoreal" }))).toMatch(/style must be/);
    expect(check(params({ soft: "yes" }))).toMatch(/soft must be/);
  });

  it("is a step only the site makes: the Add step menu does not offer it", () => {
    const graph = { schemaVersion: 1 as const, nodes: [], edges: [] };
    expect(addChoices(graph).map((c) => c.type)).not.toContain("build-world");
    expect(addChoices(graph).map((c) => c.type)).toContain("build-environment");
  });
});
