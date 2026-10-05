import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { BlenderJob, BlenderService, BuiltResult } from "@/lib/blender/types";
import type { BuildBody } from "@/lib/builder/recipes";
import { makeBuilderService } from "@/lib/builder/service";
import type { BuildModelInput } from "@/lib/builder/types";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, NodeError } from "@/lib/graph/types";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../../../../blender-worker/fixtures/recipes/${name}`, import.meta.url), "utf8")) as BuildBody;

const job: BlenderJob = { user: { uid: "alice", email: "alice@punx.ai" }, graphId: "g1", derived: {} as DerivedFiles, deadline: 99 };
const SHA = "d".repeat(64);
const AI_DOWN = "Build Model: The AI service did not answer. Try again.";

function setup(reply: () => Promise<BuiltResult> = async () => ({ sha256: SHA, size: 24_824, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: false })) {
  const builds: { job: BlenderJob; label: string; body: BuildBody }[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(j, input) {
      builds.push({ job: j, label: input.label, body: input.body });
      return reply();
    },
  };
  return { service: makeBuilderService({ blender, now: () => 0 }), builds };
}

const input = (extra: Partial<BuildModelInput> = {}): BuildModelInput => ({
  role: "hero",
  kind: "biped",
  description: "",
  motions: { run: "", jump: "", loop: "" },
  picture: null,
  palette: SAMPLE_PALETTE,
  ...extra,
});
const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("the builder service without AI", () => {
  it("builds the default recipe and the role's default motions for a chosen kind with every box empty", async () => {
    const t = setup();
    const built = await t.service.buildModel(job, input());

    expect(t.builds).toHaveLength(1);
    expect(t.builds[0].job).toBe(job);
    expect(t.builds[0].label).toBe("Build Model");
    expect(t.builds[0].body).toEqual(fixture("biped-default.json"));
    expect(built).toEqual({
      sha256: SHA,
      size: 24_824,
      kind: "biped",
      parts: 15,
      triangles: 180,
      clips: ["Run", "Jump"],
      summary: "A blocky two-legged character.",
      skipped: [],
      reused: false,
    });
  });

  it.each([
    ["obstacle", "vehicle", "vehicle-default.json"],
    ["collectible", "prop", "prop-default.json"],
  ] as const)("gives a %s only the Loop clip", async (role, kind, file) => {
    const t = setup(async () => ({ sha256: SHA, size: 1, triangles: 12, parts: 1, clips: ["Loop"], reused: false }));
    await t.service.buildModel(job, input({ role, kind }));
    expect(Object.keys(t.builds[0].body.motions.motions)).toEqual(["loop"]);
    expect(t.builds[0].body.recipe.kind).toBe(kind);
    expect(t.builds[0].body.motions).toEqual(fixture(file).motions);
  });

  it("counts a description of only spaces and control characters as empty", async () => {
    const t = setup();
    const error = await failure(t.service.buildModel(job, input({ kind: "auto", description: "  \u0007 \n " })));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Build Model: describe it first, or pick a kind.");
    expect(t.builds).toHaveLength(0);

    // and the same text beside a chosen kind is no words at all: the default is built, with no AI
    await t.service.buildModel(job, input({ description: "  \u0007 \n ", motions: { run: "\u0000\t ", jump: "", loop: "" } }));
    expect(t.builds).toHaveLength(1);
  });

  it("says to describe it first, or pick a kind, for Auto with an empty description, and builds nothing", async () => {
    const t = setup();
    const error = await failure(t.service.buildModel(job, input({ kind: "auto" })));
    expect((error as Error).message).toBe("Build Model: describe it first, or pick a kind.");
    expect(t.builds).toHaveLength(0);
  });

  it("says the AI service did not answer, and builds nothing, for a description, or a Run box on a hero, with no AI wired", async () => {
    const t = setup();
    for (const wanted of [
      input({ description: "a red fox in a scarf" }),
      input({ kind: "auto", description: "a red fox in a scarf" }),
      input({ motions: { run: "sprint like a cheetah", jump: "", loop: "" } }),
      input({ motions: { run: "", jump: "a big floaty leap", loop: "" } }),
      input({ role: "obstacle", kind: "vehicle", motions: { run: "", jump: "", loop: "spin the wheels" } }),
    ]) {
      const error = await failure(t.service.buildModel(job, wanted));
      expect(error).toBeInstanceOf(NodeError);
      expect((error as Error).message).toBe(AI_DOWN);
    }
    expect(t.builds).toHaveLength(0);
  });

  it("ignores a Loop box on a hero (it is not one of the hero's clips) and builds the default", async () => {
    const t = setup();
    await t.service.buildModel(job, input({ motions: { run: "", jump: "", loop: "spin round and round" } }));
    expect(t.builds[0].body).toEqual(fixture("biped-default.json"));
  });

  it("ignores a Run box on an obstacle in the same way", async () => {
    const t = setup(async () => ({ sha256: SHA, size: 1, triangles: 136, parts: 6, clips: ["Loop"], reused: false }));
    await t.service.buildModel(job, input({ role: "obstacle", kind: "vehicle", motions: { run: "run fast", jump: "", loop: "" } }));
    expect(t.builds).toHaveLength(1);
  });

  it("changes only the palette in the body when the palette changes", async () => {
    const t = setup();
    await t.service.buildModel(job, input());
    await t.service.buildModel(job, input({ palette: ["#000001", "#000002", "#000003", "#000004", "#000005"] }));
    const [first, second] = t.builds.map((b) => b.body);
    expect(second.recipe).toEqual(first.recipe);
    expect(second.motions).toEqual(first.motions);
    expect(second.palette).toEqual(["#000001", "#000002", "#000003", "#000004", "#000005"]);
    expect(first.palette).toEqual([...SAMPLE_PALETTE]);
  });

  it("passes a NodeError from the Blender service through unchanged", async () => {
    const original = new NodeError("Build Model: The Blender service did not answer. Try again.");
    const t = setup(async () => {
      throw original;
    });
    expect(await failure(t.service.buildModel(job, input()))).toBe(original);
  });

  it("hands on whether the build was reused", async () => {
    const t = setup(async () => ({ sha256: SHA, size: 24_824, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: true }));
    expect((await t.service.buildModel(job, input())).reused).toBe(true);
  });

  it("does not let the person's palette array be changed by the body it builds", async () => {
    const t = setup();
    const palette = [...SAMPLE_PALETTE];
    await t.service.buildModel(job, input({ palette }));
    t.builds[0].body.palette[0] = "#123456";
    expect(palette[0]).toBe(SAMPLE_PALETTE[0]);
  });
});
