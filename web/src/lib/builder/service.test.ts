import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dayOf } from "@/lib/ai/key";
import { MemoryUsageLimits, ScriptedDesigner } from "@/lib/ai/memory";
import { AiRefusedError, AiUnavailableError } from "@/lib/ai/types";
import { buildKey } from "@/lib/blender/key";
import type { BlenderJob, BlenderService, BuiltResult } from "@/lib/blender/types";
import { type ModelKind, WORLD_PIECES } from "@/lib/builder/kinds";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import {
  type BuildBody,
  clipsOf,
  checkBuildBody,
  defaultRecipe,
  estimate,
  type EnvironmentDesign,
  type ModelRecipe,
  type MotionRecipe,
  partCount,
  sceneryMotions,
  sceneryRecipe,
  type Skipped,
  triangleEstimate,
  worldRecipe,
} from "@/lib/builder/recipes";
import { makeBuilderService } from "@/lib/builder/service";
import type { AnyBuildBody } from "@/lib/builder/recipes";
import type { BuildEnvironmentInput, BuildModelInput } from "@/lib/builder/types";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { RAN_OUT_OF_TIME } from "@/lib/graph/playTime";
import { type DerivedFiles, NodeError } from "@/lib/graph/types";
import { makePng } from "@/lib/testing/images";

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
      builds.push({ job: j, label: input.label, body: kitBody(input.body) });
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

// ---------------------------------------------------------------------------------------------------------------------------------
// The design call: Claude writes the look of the model.

const BOB = { uid: "bob", email: "bob@punx.ai" };
const NO_ANSWER = "Build Model: The AI service did not answer. Try again.";
const COULD_NOT = "Build Model: The AI could not build this. Try different words.";
const DECLINED = "Build Model: The AI declined this request. Try different words.";
const PERSON = "Build Model: You have used today's AI answers. Try again tomorrow.";
const SITE = "Build Model: The AI is busy today. Try again tomorrow.";
const OUT_OF_TIME = `Build Model: ${RAN_OUT_OF_TIME}`;
const USAGE = { inputTokens: 3000, outputTokens: 300 };

/** What Claude might say for a model: the recipe's own fields, with a summary, in the answer's shape. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rawModel = (kind: ModelKind = "biped", change: (raw: any) => void = () => {}) => {
  const recipe = defaultRecipe(kind);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any = { kind, summary: "A red fox in a scarf.", build: { ...recipe.build }, colors: { ...recipe.colors }, extras: kind === "biped" ? ["tail"] : [] };
  change(raw);
  return raw;
};
const answer = (raw: unknown) => async () => ({ raw, usage: USAGE });
/** One track of a motion, as Claude might write it. */
const track = (joint: string, change: Record<string, unknown> = {}) => ({ joint, channel: "rotate", axis: "x", wave: "swing", amplitude: 30, cycles: 1, phase: 0, ...change });
/** What Claude might say for motions: the clips it was asked for, each a length and tracks. */
const rawMotions = (clips: Record<string, unknown[]>) => ({ motions: Object.fromEntries(Object.entries(clips).map(([clip, tracks]) => [clip, { seconds: 0.6, tracks }])) });
const everyClip = () => rawMotions({ run: [track("thigh_l", { amplitude: 55 })], jump: [track("thigh_l", { amplitude: -55 })], loop: [track("body", { axis: "y" })] });
const rawWorld = (change: (raw: any) => void = () => {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const raw = { sky: 1, field: 2, stripe: 0, scenery: ["pine", "lamp"] };
  change(raw);
  return raw;
};
const scriptedDesigner = (raw: () => unknown = () => rawModel(), motion: () => unknown = everyClip, world: () => unknown = () => rawWorld()) =>
  new ScriptedDesigner({
    designModel: async () => ({ raw: raw(), usage: USAGE }),
    designMotion: async () => ({ raw: motion(), usage: USAGE }),
    designEnvironment: async () => ({ raw: world(), usage: USAGE }),
  });
const designCalls = (designer: ScriptedDesigner) => designer.calls.filter((call) => call.method === "designModel");
const motionCalls = (designer: ScriptedDesigner) => designer.calls.filter((call) => call.method === "designMotion");

class FailingCache<T> extends MemoryRecipeCache<T> {
  override async put(): Promise<void> {
    throw new Error("firestore is down");
  }
}

function setupAi(
  options: {
    designer?: ScriptedDesigner;
    perPerson?: number;
    total?: number;
    reverseKeys?: boolean;
    failingDesignCache?: boolean;
    /** The build with this number (counting from 1) fails with this error. */
    failBuild?: { at: number; error: Error };
  } = {},
) {
  const designs = options.failingDesignCache ? new FailingCache<ModelRecipe>() : new MemoryRecipeCache<ModelRecipe>({ reverseKeys: options.reverseKeys });
  const motions = new MemoryRecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>();
  const environments = new MemoryRecipeCache<EnvironmentDesign>({ reverseKeys: options.reverseKeys });
  const limits = new MemoryUsageLimits();
  const designer = options.designer ?? scriptedDesigner();
  const clock = { ms: Date.UTC(2026, 9, 6, 12) };
  const logs: object[] = [];
  const seen = new Set<string>();
  const builds: { job: BlenderJob; label: string; body: BuildBody; key: string }[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(j, request) {
      const body = kitBody(request.body);
      const key = await buildKey({ graphId: j.graphId, body });
      if (options.failBuild?.at === builds.length + 1) {
        builds.push({ job: j, label: request.label, body, key });
        throw options.failBuild.error;
      }
      const reused = seen.has(key);
      seen.add(key);
      builds.push({ job: j, label: request.label, body, key });
      // the hash of the body stands for the stored file; the counts are the kit's
      if (body.recipe.quality === "high") {
        const counts = estimate(body.recipe);
        return { sha256: key, size: 24_824, triangles: counts.triangles, parts: counts.parts, vertices: counts.vertices, clips: clipsOf(body.motions), reused };
      }
      return { sha256: key, size: 24_824, triangles: triangleEstimate(body.recipe), parts: partCount(body.recipe), clips: clipsOf(body.motions), reused };
    },
  };
  const service = makeBuilderService({
    blender,
    now: () => clock.ms,
    log: (info) => logs.push(info),
    ai: { designer, designs, motions, environments, limits, modelId: "claude-sonnet-5-5", perPerson: options.perPerson ?? 30, total: options.total ?? 300 },
  });
  const jobFor = (left = 200_000, user = job.user): BlenderJob => ({ ...job, user, deadline: clock.ms + left });
  const aiCount = () => limits.counts.get(`site_${dayOf(clock.ms)}`) ?? 0;
  return { service, designer, designs, environments, limits, logs, builds, clock, jobFor, aiCount };
}

/** The kit tests only build kit bodies: a freeform body here is a mistake in the test. */
const kitBody = (body: AnyBuildBody): BuildBody => {
  if (!("motions" in body)) throw new Error("a freeform body in a kit test");
  return body;
};

const words = (description: string, extra: Partial<BuildModelInput> = {}): BuildModelInput => input({ kind: "auto", description, ...extra });

describe("the design call", () => {
  it("designs a description once: a repeat makes no call, takes no count, and says it reused the result", async () => {
    const t = setupAi();
    const first = await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    expect(first).toMatchObject({ kind: "biped", summary: "A red fox in a scarf.", reused: false });
    expect(designCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(1);

    const again = await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    expect(designCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(1);
    expect(again.reused).toBe(true);
    expect(t.builds).toHaveLength(2);
  });

  it("builds the recipe Claude designed, repaired, with the role's default motions and the palette", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    const { recipe, motions, palette } = t.builds[0].body;
    expect(recipe).toMatchObject({ version: 1, kind: "biped", summary: "A red fox in a scarf.", extras: ["tail"] });
    expect(Object.keys(motions.motions)).toEqual(["run", "jump"]);
    expect(palette).toEqual([...SAMPLE_PALETTE]);
  });

  it("reuses the build for a repeat whose recipe came back from the cache with its keys in another order (Review Focus 1)", async () => {
    const t = setupAi({ reverseKeys: true });
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    const again = await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));

    expect(designCalls(t.designer)).toHaveLength(1);
    expect(JSON.stringify(t.builds[1].body.recipe)).not.toBe(JSON.stringify(t.builds[0].body.recipe)); // the order really did change
    expect(t.builds[1].key).toBe(t.builds[0].key);
    expect(again.reused).toBe(true);
  });

  it("sends the chosen kind and keeps it even when Claude answers another", async () => {
    const t = setupAi({ designer: scriptedDesigner(() => rawModel("blob")) });
    const built = await t.service.buildModel(t.jobFor(), input({ kind: "biped", description: "a round little guy" }));

    expect(t.designer.calls[0].request).toMatchObject({ kind: "biped", role: "hero", description: "a round little guy" });
    expect(built.kind).toBe("biped");
    expect(t.builds[0].body.recipe.kind).toBe("biped");
  });

  it("sends kind null for Auto, and an unknown kind back is the could-not-build sentence, with the count kept and nothing cached", async () => {
    const t = setupAi({ designer: scriptedDesigner(() => rawModel("biped", (raw) => (raw.kind = "dragon"))) });
    const error = await failure(t.service.buildModel(t.jobFor(), words("a dragon")));

    expect(t.designer.calls[0].request).toMatchObject({ kind: null });
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(COULD_NOT);
    expect(t.aiCount()).toBe(1);
    expect(t.designs.entries.size).toBe(0);
    expect(t.builds).toHaveLength(0);

    await failure(t.service.buildModel(t.jobFor(), words("a dragon")));
    expect(designCalls(t.designer)).toHaveLength(2); // nothing was cached, so it asks again
  });

  it("says could-not-build, keeping the count, when the answer is not JSON at all", async () => {
    const t = setupAi({ designer: new ScriptedDesigner({ designModel: answer(undefined) }) });
    expect(((await failure(t.service.buildModel(t.jobFor(), words("a fox")))) as Error).message).toBe(COULD_NOT);
    expect(t.aiCount()).toBe(1);
    expect(t.logs).toEqual([{ step: "build-model", call: "design", outcome: "bad-answer", ...USAGE }]);
  });

  it("makes no design call when only a motion box or the palette changes", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { palette: ["#000001", "#000002", "#000003", "#000004", "#000005"] }));
    await failure(t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "sprint like a cheetah", jump: "", loop: "" } })));
    expect(designCalls(t.designer)).toHaveLength(1);
  });

  it("makes one design call when the description, the kind setting, the role or the picture changes", async () => {
    const t = setupAi();
    const picture = { sha256: "a".repeat(64), bytes: await makePng(20, 20, [9, 9, 9]) };
    const variants: BuildModelInput[] = [
      words("a fox in a scarf"),
      words("a fox in a hat"),
      input({ kind: "biped", description: "a fox in a scarf" }),
      words("a fox in a scarf", { role: "obstacle" }),
      words("a fox in a scarf", { picture }),
    ];
    for (const [index, variant] of variants.entries()) {
      await t.service.buildModel(t.jobFor(), variant);
      expect(designCalls(t.designer)).toHaveLength(index + 1);
    }
  });

  it("sends the model a small JPEG of at most 1024 px, not the upload", async () => {
    const t = setupAi();
    const bytes = await makePng(3000, 2000, [200, 30, 30]);
    await t.service.buildModel(t.jobFor(), words("a red fox", { picture: { sha256: "b".repeat(64), bytes } }));

    const sent = (t.designer.calls[0].request as { picture: Uint8Array }).picture;
    expect(Array.from(sent.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    const meta = await sharp(sent).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1024);
  });

  it("says why a picture cannot be used, in the reader's words, calls nothing and gives the count back", async () => {
    const t = setupAi({ perPerson: 1 });
    const bad = { sha256: "c".repeat(64), bytes: new TextEncoder().encode("hello") };
    expect(await failure(t.service.buildModel(t.jobFor(), words("a fox", { picture: bad })))).toEqual(new NodeError("Build Model: this is not a PNG or JPEG picture"));
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    await t.service.buildModel(t.jobFor(), words("a fox")); // the place was given back
  });

  it("refuses with the person's and the site's sentences, and calls no one", async () => {
    const person = setupAi({ perPerson: 1 });
    await person.service.buildModel(person.jobFor(), words("one"));
    expect(((await failure(person.service.buildModel(person.jobFor(), words("two")))) as Error).message).toBe(PERSON);
    expect(designCalls(person.designer)).toHaveLength(1);

    const site = setupAi({ total: 1 });
    await site.service.buildModel(site.jobFor(), words("one"));
    expect(((await failure(site.service.buildModel(site.jobFor(200_000, BOB), words("two")))) as Error).message).toBe(SITE);
    expect(designCalls(site.designer)).toHaveLength(1);
  });

  it("keeps the count for a refusal, and gives it back when the service did not answer or failed in some other way", async () => {
    const refused = setupAi({ designer: new ScriptedDesigner({ designModel: async () => Promise.reject(new AiRefusedError()) }) });
    expect(((await failure(refused.service.buildModel(refused.jobFor(), words("x")))) as Error).message).toBe(DECLINED);
    expect(refused.aiCount()).toBe(1);
    expect(refused.logs).toEqual([{ step: "build-model", call: "design", outcome: "refused" }]);

    const unavailable = setupAi({ designer: new ScriptedDesigner({ designModel: async () => Promise.reject(new AiUnavailableError(529)) }) });
    expect(((await failure(unavailable.service.buildModel(unavailable.jobFor(), words("x")))) as Error).message).toBe(NO_ANSWER);
    expect(unavailable.aiCount()).toBe(0);
    expect(unavailable.logs).toEqual([{ step: "build-model", call: "design", outcome: "unavailable", status: 529 }]);

    const unexpected = setupAi({ designer: new ScriptedDesigner({ designModel: async () => Promise.reject(new TypeError("boom: secret")) }) });
    expect(((await failure(unexpected.service.buildModel(unexpected.jobFor(), words("x")))) as Error).message).toBe(NO_ANSWER);
    expect(unexpected.aiCount()).toBe(0);
    expect(unexpected.logs).toEqual([{ step: "build-model", call: "design", outcome: "unexpected", kind: "TypeError" }]);
  });

  it("says Play ran out of time and takes no count when a miss has less than 10 seconds left, but still builds a hit", async () => {
    const t = setupAi();
    const error = await failure(t.service.buildModel(t.jobFor(5_000), words("a fox")));
    expect((error as Error).message).toBe(OUT_OF_TIME);
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.logs).toEqual([{ step: "build-model", call: "design", outcome: "no-time" }]);

    await t.service.buildModel(t.jobFor(), words("a fox"));
    const hit = await t.service.buildModel(t.jobFor(5_000), words("a fox"));
    expect(hit.reused).toBe(true);
    expect(designCalls(t.designer)).toHaveLength(1);
  });

  it("gives Claude 60 seconds, or half the time left (the SDK retries once)", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(200_000), words("one"));
    await t.service.buildModel(t.jobFor(20_000), words("two"));
    expect(designCalls(t.designer).map((call) => (call.request as { timeoutMs: number }).timeoutMs)).toEqual([60_000, 10_000]);
  });

  it("clamps an out-of-range answer, and the clamped recipe is what is cached and built", async () => {
    const t = setupAi({ designer: scriptedDesigner(() => rawModel("biped", (raw) => (raw.build.headSize = 9))) });
    await t.service.buildModel(t.jobFor(), words("a giant head"));

    expect(t.builds[0].body.recipe.build.headSize).toBe(0.8);
    const [stored] = [...t.designs.entries.values()];
    expect(stored.value.build.headSize).toBe(0.8);
    expect(stored).toMatchObject({ model: "claude-sonnet-5-5", inputTokens: 3000, outputTokens: 300 });
  });

  it("says the result was not reused whenever Claude was asked, even if the build itself was cached", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    // another person has no cached design, so Claude is asked, and says the same: the same build, which the Blender service has
    const other = await t.service.buildModel(t.jobFor(200_000, BOB), words("a fox in a scarf"));
    expect(designCalls(t.designer)).toHaveLength(2);
    expect(t.builds[1].key).toBe(t.builds[0].key);
    expect(other.reused).toBe(false);
  });

  it("takes no AI count for a chosen kind with every box empty, even with the AI wired", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), input({ kind: "vehicle", role: "obstacle" }));
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.builds).toHaveLength(1);
  });

  it("still builds when the design cannot be cached (the answer is good and paid for)", async () => {
    const t = setupAi({ failingDesignCache: true });
    expect((await t.service.buildModel(t.jobFor(), words("a fox"))).kind).toBe("biped");
    expect(t.logs).toContainEqual({ step: "build-model", call: "design", outcome: "cache-write-failed" });
  });

  it("logs the step, the call, the outcome and the token counts, never the description, the summary or a recipe", async () => {
    const t = setupAi({ designer: scriptedDesigner(() => rawModel("biped", (raw) => (raw.summary = "A very private fox."))) });
    await t.service.buildModel(t.jobFor(), words("a very private fox in a scarf"));
    await t.service.buildModel(t.jobFor(), words("a very private fox in a scarf"));

    expect(t.logs).toEqual([
      { step: "build-model", call: "design", outcome: "answered", ...USAGE },
      { step: "build-model", call: "design", outcome: "reused" },
    ]);
    const text = JSON.stringify(t.logs);
    for (const secret of ["private", "fox", "scarf", "headSize", "thigh", "colors", "extras"]) expect(text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The motion call: Claude writes how the model moves.

const motionRequest = (designer: ScriptedDesigner, index = 0) => motionCalls(designer)[index].request as { kind: string; joints: string[]; texts: Record<string, string>; timeoutMs: number };
const gallop = (extra: Partial<BuildModelInput> = {}): BuildModelInput => input({ kind: "biped", motions: { run: "gallop like a horse", jump: "", loop: "" }, ...extra });

describe("the motion call", () => {
  it("asks only for the clips that have text, and the rest take the defaults", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, () => rawMotions({ run: [track("thigh_l", { amplitude: 55 }), track("thigh_r", { amplitude: 55, phase: 0.5 })] })) });
    await t.service.buildModel(t.jobFor(), gallop());

    expect(motionRequest(t.designer).texts).toEqual({ run: "gallop like a horse" });
    const { motions } = t.builds[0].body.motions;
    expect(motions.run!.tracks.map((tr) => tr.joint)).toEqual(["thigh_l", "thigh_r"]);
    expect(motions.run!.tracks[0].amplitude).toBe(55);
    expect(motions.jump).toEqual(fixture("biped-default.json").motions.motions.jump);
  });

  it("asks both clips of a hero when both boxes have words, and the Loop clip alone for an obstacle", async () => {
    const hero = setupAi();
    await hero.service.buildModel(hero.jobFor(), input({ kind: "biped", motions: { run: "gallop", jump: "leap", loop: "ignored for a hero" } }));
    expect(motionRequest(hero.designer).texts).toEqual({ run: "gallop", jump: "leap" });

    const obstacle = setupAi({ designer: scriptedDesigner(undefined, () => rawMotions({ loop: [track("body", { axis: "y" })] })) });
    await obstacle.service.buildModel(obstacle.jobFor(), input({ role: "obstacle", kind: "vehicle", motions: { run: "ignored", jump: "ignored", loop: "wobble" } }));
    expect(motionRequest(obstacle.designer).texts).toEqual({ loop: "wobble" });
  });

  it("with an empty description and a chosen kind asks for the motion only, with the default recipe's joints", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), gallop());

    expect(designCalls(t.designer)).toHaveLength(0);
    expect(motionRequest(t.designer).kind).toBe("biped");
    expect(motionRequest(t.designer).joints).toHaveLength(17);
    expect(motionRequest(t.designer).joints.slice(0, 3)).toEqual(["hips", "spine", "chest"]);
    expect(t.builds[0].body.recipe).toEqual(defaultRecipe("biped"));
  });

  it("makes one motion call, no design call, and builds the same recipe when only a motion box changes", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "gallop", jump: "", loop: "" } }));
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "trot", jump: "", loop: "" } }));

    expect(designCalls(t.designer)).toHaveLength(1);
    expect(motionCalls(t.designer)).toHaveLength(2);
    expect(t.builds[1].body.recipe).toEqual(t.builds[0].body.recipe);
  });

  it("answers a repeat from the cache: no call, no count, and the result says it was reused", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "gallop", jump: "", loop: "" } }));
    const again = await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "gallop", jump: "", loop: "" } }));

    expect(t.designer.calls).toHaveLength(2);
    expect(t.aiCount()).toBe(2);
    expect(again.reused).toBe(true);
    expect(t.logs.filter((log) => (log as { call?: string }).call === "motion")).toEqual([
      { step: "build-model", call: "motion", outcome: "answered", ...USAGE },
      { step: "build-model", call: "motion", outcome: "reused" },
    ]);
  });

  it("gives a recipe with a tail another motion key, because the joints are part of it", async () => {
    const designer = new ScriptedDesigner({
      designModel: async (request) => ({ raw: rawModel("biped", (raw) => (raw.extras = request.description.includes("tail") ? ["tail"] : [])), usage: USAGE }),
      designMotion: async () => ({ raw: everyClip(), usage: USAGE }),
    });
    const t = setupAi({ designer });
    const run = { run: "gallop", jump: "", loop: "" };
    await t.service.buildModel(t.jobFor(), words("a fox with a tail", { motions: run }));
    await t.service.buildModel(t.jobFor(), words("a fox without one", { motions: run }));

    expect(motionCalls(designer)).toHaveLength(2);
    expect(motionRequest(designer, 0).joints).toContain("tail_1");
    expect(motionRequest(designer, 1).joints).not.toContain("tail_1");
  });

  it("drops a track on a joint the model lacks, lists it in skipped, and brings skipped back from the cache", async () => {
    const answerWithTail = () => rawMotions({ loop: [track("body", { axis: "y", wave: "bounce", amplitude: 0.1 }), track("tail_1", { axis: "z" })] });
    const t = setupAi({ designer: scriptedDesigner(undefined, answerWithTail) });
    const wag = input({ role: "collectible", kind: "blob", motions: { run: "", jump: "", loop: "wag the tail" } });

    const first = await t.service.buildModel(t.jobFor(), wag);
    expect(first.skipped).toEqual([{ clip: "Loop", joint: "tail_1" }]);
    expect(t.builds[0].body.motions.motions.loop!.tracks.map((tr) => tr.joint)).toEqual(["body"]);

    const again = await t.service.buildModel(t.jobFor(), wag);
    expect(motionCalls(t.designer)).toHaveLength(1);
    expect(again.skipped).toEqual([{ clip: "Loop", joint: "tail_1" }]);
    expect(again.reused).toBe(true);
  });

  it("builds the default Run, and still lists the tracks, when every Run track names a joint the model lacks", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, () => rawMotions({ run: [track("wing_l"), track("wing_r")] })) });
    const built = await t.service.buildModel(t.jobFor(), gallop());

    expect(t.builds[0].body.motions.motions.run).toEqual(fixture("biped-default.json").motions.motions.run);
    expect(built.skipped).toEqual([
      { clip: "Run", joint: "wing_l" },
      { clip: "Run", joint: "wing_r" },
    ]);
  });

  it("takes one AI count for the design and one for the motion, and builds once", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { motions: { run: "gallop", jump: "", loop: "" } }));
    expect(t.aiCount()).toBe(2);
    expect(t.builds).toHaveLength(1);
  });

  it("counts a motion box of only spaces and control characters as empty: no motion call, no count (Review Focus 2)", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), input({ kind: "biped", motions: { run: "\u0007\u0000 \t\n", jump: "  ", loop: "" } }));
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.builds[0].body).toEqual(fixture("biped-default.json"));

    await t.service.buildModel(t.jobFor(), words("a fox", { motions: { run: "\u0007\u0000", jump: "", loop: "" } }));
    expect(motionCalls(t.designer)).toHaveLength(0);
    expect(t.aiCount()).toBe(1); // only the design
  });

  it("refuses a motion with the person's sentence and calls no one, when the design already used the person's last count", async () => {
    const t = setupAi({ perPerson: 1 });
    const error = await failure(t.service.buildModel(t.jobFor(), words("a fox", { motions: { run: "gallop", jump: "", loop: "" } })));
    expect((error as Error).message).toBe(PERSON);
    expect(motionCalls(t.designer)).toHaveLength(0);
    expect(t.logs.at(-1)).toEqual({ step: "build-model", call: "motion", outcome: "person-limit" });
  });

  it("refuses a motion with the site's sentence when the site's count is gone", async () => {
    const t = setupAi({ total: 1 });
    const error = await failure(t.service.buildModel(t.jobFor(), words("a fox", { motions: { run: "gallop", jump: "", loop: "" } })));
    expect((error as Error).message).toBe(SITE);
    expect(motionCalls(t.designer)).toHaveLength(0);
  });

  it("keeps the count for a refusal, and gives it back when the service did not answer or failed in some other way", async () => {
    const make = (reject: () => Error) =>
      setupAi({ designer: new ScriptedDesigner({ designMotion: async () => Promise.reject(reject()) }) });

    const refused = make(() => new AiRefusedError());
    expect(((await failure(refused.service.buildModel(refused.jobFor(), gallop()))) as Error).message).toBe(DECLINED);
    expect(refused.aiCount()).toBe(1);
    expect(refused.logs).toEqual([{ step: "build-model", call: "motion", outcome: "refused" }]);

    const unavailable = make(() => new AiUnavailableError(503));
    expect(((await failure(unavailable.service.buildModel(unavailable.jobFor(), gallop()))) as Error).message).toBe(NO_ANSWER);
    expect(unavailable.aiCount()).toBe(0);
    expect(unavailable.logs).toEqual([{ step: "build-model", call: "motion", outcome: "unavailable", status: 503 }]);

    const unexpected = make(() => new RangeError("boom: secret"));
    expect(((await failure(unexpected.service.buildModel(unexpected.jobFor(), gallop()))) as Error).message).toBe(NO_ANSWER);
    expect(unexpected.aiCount()).toBe(0);
    expect(unexpected.logs).toEqual([{ step: "build-model", call: "motion", outcome: "unexpected", kind: "RangeError" }]);
  });

  it("says could-not-build, keeping the count and caching nothing, when the answer cannot be repaired", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, () => "not motions") });
    expect(((await failure(t.service.buildModel(t.jobFor(), gallop()))) as Error).message).toBe(COULD_NOT);
    expect(t.aiCount()).toBe(1);
    expect(t.builds).toHaveLength(0);
    expect(t.logs).toEqual([{ step: "build-model", call: "motion", outcome: "bad-answer", ...USAGE }]);
    await failure(t.service.buildModel(t.jobFor(), gallop()));
    expect(motionCalls(t.designer)).toHaveLength(2);
  });

  it("says Play ran out of time and takes no count for a motion miss with less than 10 seconds left, but a hit still builds", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), words("a fox", { motions: { run: "gallop", jump: "", loop: "" } }));

    const error = await failure(t.service.buildModel(t.jobFor(5_000), words("a fox", { motions: { run: "trot", jump: "", loop: "" } })));
    expect((error as Error).message).toBe(OUT_OF_TIME);
    expect(motionCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(2);
    expect(t.logs.at(-1)).toEqual({ step: "build-model", call: "motion", outcome: "no-time" });

    const hit = await t.service.buildModel(t.jobFor(5_000), words("a fox", { motions: { run: "gallop", jump: "", loop: "" } }));
    expect(hit.reused).toBe(true);
  });

  it("gives Claude 60 seconds, or half the time left, for a motion", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(200_000), gallop());
    await t.service.buildModel(t.jobFor(20_000), gallop({ motions: { run: "trot", jump: "", loop: "" } }));
    expect([0, 1].map((index) => motionRequest(t.designer, index).timeoutMs)).toEqual([60_000, 10_000]);
  });

  it("says the result was not reused whenever Claude was asked for a motion, even if the build was cached", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), gallop());
    const other = await t.service.buildModel(t.jobFor(200_000, BOB), gallop());
    expect(motionCalls(t.designer)).toHaveLength(2);
    expect(t.builds[1].key).toBe(t.builds[0].key);
    expect(other.reused).toBe(false);
  });

  it("logs the motion call without the words, the joints or a track", async () => {
    const t = setupAi();
    await t.service.buildModel(t.jobFor(), gallop({ motions: { run: "a very private gallop", jump: "", loop: "" } }));
    const text = JSON.stringify(t.logs);
    for (const secret of ["private", "gallop", "thigh", "amplitude", "tracks"]) expect(text).not.toContain(secret);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The environment: Claude picks colors and scenery, and one worker job builds each piece.

const NO_ANSWER_WORLD = "Build Environment: The AI service did not answer. Try again.";
const COULD_NOT_WORLD = "Build Environment: The AI could not build this. Try different words.";
const DECLINED_WORLD = "Build Environment: The AI declined this request. Try different words.";
const PERSON_WORLD = "Build Environment: You have used today's AI answers. Try again tomorrow.";
const SITE_WORLD = "Build Environment: The AI is busy today. Try again tomorrow.";
const OUT_OF_TIME_WORLD = `Build Environment: ${RAN_OUT_OF_TIME}`;
const STEP_WORLD = "build-environment";

const theme = (text: string, extra: Partial<BuildEnvironmentInput> = {}): BuildEnvironmentInput => ({ theme: text, density: "some", palette: SAMPLE_PALETTE, ...extra });
const environmentCalls = (designer: ScriptedDesigner) => designer.calls.filter((call) => call.method === "designEnvironment");
const piecesBuilt = (t: ReturnType<typeof setupAi>) => t.builds.map((b) => (b.body.recipe.build as { scenery: string }).scenery);

describe("the environment", () => {
  it("builds the meadow's three pieces for an empty theme, with no AI call and no AI count", async () => {
    const t = setupAi();
    const built = await t.service.buildEnvironment(t.jobFor(), theme(""));

    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(piecesBuilt(t)).toEqual(["tree", "windmill", "rock"]);
    expect(t.builds.map((b) => b.label)).toEqual(["Build Environment", "Build Environment", "Build Environment"]);
    expect(built).toMatchObject({ sky: 0, field: 3, stripe: 4, density: "some", reused: false });
    expect(built.scenery.map((piece) => piece.kind)).toEqual(["tree", "windmill", "rock"]);
    expect(built.scenery[0]).toEqual({ kind: "tree", sha256: t.builds[0].key, size: 24_824, triangles: 188 });
  });

  it("sends each piece as the kit's recipe and motions with the palette", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("", { palette: ["#000001", "#000002", "#000003", "#000004", "#000005"] }));
    for (const [index, kind] of (["tree", "windmill", "rock"] as const).entries()) {
      expect(t.builds[index].body).toEqual({ recipe: sceneryRecipe(kind), motions: sceneryMotions(kind), palette: ["#000001", "#000002", "#000003", "#000004", "#000005"] });
    }
  });

  it("counts a theme of only spaces and control characters as empty: no AI call, no count (Review Focus 2)", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme(" \u0007\u0000 \t\n "));
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(piecesBuilt(t)).toEqual(["tree", "windmill", "rock"]);
  });

  it("designs a theme once: a repeat makes no call, takes no count, builds nothing new, and says it reused the result", async () => {
    const t = setupAi();
    const first = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    expect(first).toMatchObject({ sky: 1, field: 2, stripe: 0, reused: false });
    expect(first.scenery.map((piece) => piece.kind)).toEqual(["pine", "lamp"]);
    expect(environmentCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(1);
    expect(t.designer.calls[0].request).toMatchObject({ theme: "a snowy night" });

    const again = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    expect(environmentCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(1);
    expect(again.reused).toBe(true);
    expect(t.builds.slice(2).map((b) => b.key)).toEqual(t.builds.slice(0, 2).map((b) => b.key)); // the same builds, which the Blender service has
  });

  it("reuses the builds for a repeat whose design came back from the cache with its keys in another order", async () => {
    const t = setupAi({ reverseKeys: true });
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    const again = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    expect(environmentCalls(t.designer)).toHaveLength(1);
    expect(again.reused).toBe(true);
  });

  it("keeps the density out of every key: changing it makes no AI call and asks for no new build", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night", { density: "some" }));
    const lots = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night", { density: "lots" }));

    expect(environmentCalls(t.designer)).toHaveLength(1);
    expect(lots.density).toBe("lots");
    expect(t.builds.slice(2).map((b) => b.key)).toEqual(t.builds.slice(0, 2).map((b) => b.key));
    expect(lots.reused).toBe(true);
  });

  it("rebuilds the scenery for another palette with no AI call", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    const other = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night", { palette: ["#000001", "#000002", "#000003", "#000004", "#000005"] }));

    expect(environmentCalls(t.designer)).toHaveLength(1);
    expect(t.aiCount()).toBe(1);
    expect(new Set(t.builds.map((b) => b.key)).size).toBe(4); // two pieces in two palettes
    expect(other.reused).toBe(false);
  });

  it("designs again for another theme or another person", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    await t.service.buildEnvironment(t.jobFor(), theme("a hot desert"));
    await t.service.buildEnvironment(t.jobFor(200_000, BOB), theme("a snowy night"));
    expect(environmentCalls(t.designer)).toHaveLength(3);
  });

  it("clamps an out-of-range answer, and the repaired design is what is cached and built", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => rawWorld((raw) => ((raw.sky = 7), (raw.scenery = ["tree", "castle", "tree", "rock", "lamp", "pine"])))) });
    const built = await t.service.buildEnvironment(t.jobFor(), theme("a wild place"));

    expect(built.sky).toBe(4);
    expect(built.scenery.map((piece) => piece.kind)).toEqual(["tree", "rock", "lamp"]);
    const [stored] = [...t.environments.entries.values()];
    expect(stored.value).toEqual({ version: 1, sky: 4, field: 2, stripe: 0, scenery: ["tree", "rock", "lamp"] });
    expect(stored).toMatchObject({ model: "claude-sonnet-5-5", inputTokens: 3000, outputTokens: 300 });
  });

  it("builds the meadow's pieces when every piece Claude named is unknown", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => rawWorld((raw) => (raw.scenery = ["castle"]))) });
    const built = await t.service.buildEnvironment(t.jobFor(), theme("a castle"));
    expect(built.scenery.map((piece) => piece.kind)).toEqual(["tree", "windmill", "rock"]);
  });

  it("says the result was not reused whenever Claude was asked, even if every build was cached", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    const other = await t.service.buildEnvironment(t.jobFor(200_000, BOB), theme("a snowy night"));
    expect(environmentCalls(t.designer)).toHaveLength(2);
    expect(other.reused).toBe(false);
  });

  it("says the result was not reused when one build was new, though Claude was not asked", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    // the same design with a new palette: the design is cached, but both builds are new
    const again = await t.service.buildEnvironment(t.jobFor(), theme("a snowy night", { palette: ["#0a0a0a", "#0b0b0b", "#0c0c0c", "#0d0d0d", "#0e0e0e"] }));
    expect(again.reused).toBe(false);
  });

  it("says could-not-build, keeping the count and caching nothing, when the answer is not an object", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => "a nice meadow") });
    expect(((await failure(t.service.buildEnvironment(t.jobFor(), theme("x")))) as Error).message).toBe(COULD_NOT_WORLD);
    expect(t.aiCount()).toBe(1);
    expect(t.environments.entries.size).toBe(0);
    expect(t.builds).toHaveLength(0);
    expect(t.logs).toEqual([{ step: STEP_WORLD, call: "environment", outcome: "bad-answer", ...USAGE }]);
  });

  it("refuses with the person's and the site's sentences, and calls no one", async () => {
    const person = setupAi({ perPerson: 1 });
    await person.service.buildEnvironment(person.jobFor(), theme("one"));
    expect(((await failure(person.service.buildEnvironment(person.jobFor(), theme("two")))) as Error).message).toBe(PERSON_WORLD);
    expect(environmentCalls(person.designer)).toHaveLength(1);

    const site = setupAi({ total: 1 });
    await site.service.buildEnvironment(site.jobFor(), theme("one"));
    expect(((await failure(site.service.buildEnvironment(site.jobFor(200_000, BOB), theme("two")))) as Error).message).toBe(SITE_WORLD);
    expect(environmentCalls(site.designer)).toHaveLength(1);
  });

  it("keeps the count for a refusal, and gives it back when the service did not answer or failed in some other way", async () => {
    const make = (reject: () => Error) => setupAi({ designer: new ScriptedDesigner({ designEnvironment: async () => Promise.reject(reject()) }) });

    const refused = make(() => new AiRefusedError());
    expect(((await failure(refused.service.buildEnvironment(refused.jobFor(), theme("x")))) as Error).message).toBe(DECLINED_WORLD);
    expect(refused.aiCount()).toBe(1);
    expect(refused.logs).toEqual([{ step: STEP_WORLD, call: "environment", outcome: "refused" }]);

    const unavailable = make(() => new AiUnavailableError(529));
    expect(((await failure(unavailable.service.buildEnvironment(unavailable.jobFor(), theme("x")))) as Error).message).toBe(NO_ANSWER_WORLD);
    expect(unavailable.aiCount()).toBe(0);
    expect(unavailable.logs).toEqual([{ step: STEP_WORLD, call: "environment", outcome: "unavailable", status: 529 }]);

    const unexpected = make(() => new TypeError("boom: secret"));
    expect(((await failure(unexpected.service.buildEnvironment(unexpected.jobFor(), theme("x")))) as Error).message).toBe(NO_ANSWER_WORLD);
    expect(unexpected.aiCount()).toBe(0);
    expect(unexpected.logs).toEqual([{ step: STEP_WORLD, call: "environment", outcome: "unexpected", kind: "TypeError" }]);
  });

  it("says a theme needs the AI when none is wired, and builds nothing", async () => {
    const bare = makeBuilderService({
      blender: { prepare: async () => Promise.reject(new Error("no")), shape: async () => Promise.reject(new Error("no")), build: async () => Promise.reject(new Error("no")) },
      now: () => 0,
    });
    expect(((await failure(bare.buildEnvironment(job, theme("a snowy night")))) as Error).message).toBe(NO_ANSWER_WORLD);
  });

  it("says Play ran out of time and takes no count for a miss with less than 10 seconds left, but a hit still builds", async () => {
    const t = setupAi();
    const error = await failure(t.service.buildEnvironment(t.jobFor(5_000), theme("a snowy night")));
    expect((error as Error).message).toBe(OUT_OF_TIME_WORLD);
    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.logs).toEqual([{ step: STEP_WORLD, call: "environment", outcome: "no-time" }]);

    await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"));
    const hit = await t.service.buildEnvironment(t.jobFor(5_000), theme("a snowy night"));
    expect(hit.reused).toBe(true);
  });

  it("gives Claude 60 seconds, or half the time left", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(200_000), theme("one"));
    await t.service.buildEnvironment(t.jobFor(20_000), theme("two"));
    expect(environmentCalls(t.designer).map((call) => (call.request as { timeoutMs: number }).timeoutMs)).toEqual([60_000, 10_000]);
  });

  it("fails the step with the Blender service's own sentence when a second piece cannot be built, and builds no more", async () => {
    const sentence = "Build Environment: The Blender service did not answer. Try again.";
    const t = setupAi({ failBuild: { at: 2, error: new NodeError(sentence) } });
    const error = await failure(t.service.buildEnvironment(t.jobFor(), theme("")));

    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe(sentence);
    expect(piecesBuilt(t)).toEqual(["tree", "windmill"]); // the third was never asked for
  });

  it("builds the pieces one after another, in the order of the design", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => rawWorld((raw) => (raw.scenery = ["lamp", "cactus", "pine"]))) });
    await t.service.buildEnvironment(t.jobFor(), theme("a street"));
    expect(piecesBuilt(t)).toEqual(["lamp", "cactus", "pine"]);
  });

  it("still builds when the design cannot be cached", async () => {
    const t = setupAi();
    t.environments.put = async () => Promise.reject(new Error("firestore is down"));
    expect((await t.service.buildEnvironment(t.jobFor(), theme("a snowy night"))).scenery).toHaveLength(2);
    expect(t.logs).toContainEqual({ step: STEP_WORLD, call: "environment", outcome: "cache-write-failed" });
  });

  it("logs the step, the call, the outcome and the token counts, never the theme or the design", async () => {
    const t = setupAi();
    await t.service.buildEnvironment(t.jobFor(), theme("a very private snowy night"));
    await t.service.buildEnvironment(t.jobFor(), theme("a very private snowy night"));
    expect(t.logs).toEqual([
      { step: STEP_WORLD, call: "environment", outcome: "answered", ...USAGE },
      { step: STEP_WORLD, call: "environment", outcome: "reused" },
    ]);
    const text = JSON.stringify(t.logs);
    for (const secret of ["private", "snowy", "pine", "lamp", "scenery"]) expect(text).not.toContain(secret);
  });
});

// ---- the Quality setting ----

const highInput = (extra: Partial<BuildModelInput> = {}): BuildModelInput => input({ quality: "high", ...extra });
// a High answer from Claude: the finishes for every color slot and the details it chose
const highAnswer = (kind: ModelKind = "biped", change: (raw: any) => void = () => {}) => // eslint-disable-line @typescript-eslint/no-explicit-any
  rawModel(kind, (raw) => {
    raw.finishes = { head: "glow", body: "matte", arms: "metal", legs: "rubber", feet: "painted", extra: "glow" };
    raw.details = ["bolts", "lights"];
    change(raw);
  });
const requestOf = (designer: ScriptedDesigner, method: string, index = 0) => designer.calls.filter((call) => call.method === method)[index].request as Record<string, unknown>;

describe("Build Model at High quality", () => {
  it.each([
    ["hero", "biped", "high/biped-high-default.json"],
    ["obstacle", "vehicle", "high/vehicle-high-default.json"],
    ["collectible", "blob", "high/blob-high-default.json"],
    ["collectible", "prop", "high/prop-high-default.json"],
  ] as const)("builds the kit's High recipe and the role's default motions for a %s %s with every box empty, with no AI call and no AI count", async (role, kind, file) => {
    const t = setupAi();
    const built = await t.service.buildModel(t.jobFor(), highInput({ role, kind }));

    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.builds).toHaveLength(1);
    expect(t.builds[0].body).toEqual(fixture(file));
    const counts = estimate(t.builds[0].body.recipe);
    expect(built).toMatchObject({ kind, quality: "high", parts: counts.parts, triangles: counts.triangles, vertices: counts.vertices, reused: false });
  });

  it("leaves a Standard step's result as it was: no quality, no vertices", async () => {
    const t = setupAi();
    const built = await t.service.buildModel(t.jobFor(), input({ kind: "biped" }));
    expect(Object.keys(built)).not.toContain("quality");
    expect(Object.keys(built)).not.toContain("vertices");
    expect(t.builds[0].body.recipe.quality).toBeUndefined();
  });

  it("asks Claude for a High design with the quality in the request, builds what it answered with its finishes and details, and keeps it apart from the Standard one", async () => {
    const t = setupAi({ designer: scriptedDesigner(() => highAnswer()) });
    const built = await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { quality: "high" }));

    expect(requestOf(t.designer, "designModel")).toMatchObject({ description: "a fox in a scarf", role: "hero", kind: null, quality: "high" });
    const { recipe } = t.builds[0].body;
    expect(recipe).toMatchObject({ kind: "biped", quality: "high", extras: ["tail"], details: ["bolts", "lights"] });
    expect(recipe.finishes).toEqual({ head: "glow", body: "matte", arms: "metal", legs: "rubber", feet: "painted", extra: "glow" });
    expect(built).toMatchObject({ quality: "high", reused: false });

    // the same words at Standard are another question: asked again, with no quality in the request
    const again = await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    expect(designCalls(t.designer)).toHaveLength(2);
    expect(Object.keys(requestOf(t.designer, "designModel", 1))).not.toContain("quality");
    expect(again).toMatchObject({ reused: false });
    expect(t.builds[1].body.recipe.quality).toBeUndefined();

    // and each is found again under its own key
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf", { quality: "high" }));
    await t.service.buildModel(t.jobFor(), words("a fox in a scarf"));
    expect(designCalls(t.designer)).toHaveLength(2);
    expect(t.aiCount()).toBe(2);
  });

  it.each([
    ["two big extras and every detail", { extras: ["backpack", "ears"], details: ["seams", "bolts", "cables", "lights"] }, ["seams", "lights"]],
    ["a hat and every detail", { extras: ["hat"], details: ["seams", "bolts", "cables", "lights"] }, ["seams", "bolts", "lights"]],
    ["the default details", { extras: ["tail"], details: ["seams", "bolts", "lights"] }, ["seams", "bolts", "lights"]],
  ])("builds a High recipe within its budget when Claude answers with %s, dropping cables, bolts, seams, lights in that order", async (_label, change, details) => {
    const t = setupAi({ designer: scriptedDesigner(() => highAnswer("biped", (raw) => Object.assign(raw, change))) });
    await t.service.buildModel(t.jobFor(), words("a fox", { quality: "high" }));
    const { recipe } = t.builds[0].body;
    expect(recipe.details).toEqual(details);
    const counts = estimate(recipe);
    expect(counts.parts).toBeLessThanOrEqual(80);
    expect(counts.triangles).toBeLessThanOrEqual(12000);
  });

  it("asks for High motions with the quality, under their own key, and cuts them to the mesh budget, saying what it cut", async () => {
    const joints = ["spine", "chest", "neck", "head", "upperarm_l", "forearm_l", "hand_l", "upperarm_r", "forearm_r", "hand_r", "thigh_l", "shin_l", "foot_l", "thigh_r", "shin_r", "foot_r"];
    const heavy = () => rawMotions({ run: joints.slice(0, 12).map((j) => track(j)), jump: joints.slice(12).map((j) => track(j)) });
    const t = setupAi({ designer: scriptedDesigner(() => rawModel(), heavy) });

    const built = await t.service.buildModel(t.jobFor(), highInput({ motions: { run: "all of it", jump: "everything", loop: "" } }));

    expect(requestOf(t.designer, "designMotion")).toMatchObject({ kind: "biped", quality: "high" });
    const body = t.builds[0].body;
    expect(checkBuildBody(body)).toBeNull(); // the worker would take it: 14 meshes
    expect(built.skipped).toEqual([
      { clip: "Jump", joint: "thigh_r", why: "budget" },
      { clip: "Jump", joint: "shin_r", why: "budget" },
      { clip: "Jump", joint: "foot_r", why: "budget" },
    ]);

    // the same words at Standard are another question
    await t.service.buildModel(t.jobFor(), input({ motions: { run: "all of it", jump: "everything", loop: "" } }));
    expect(motionCalls(t.designer)).toHaveLength(2);
    expect(Object.keys(requestOf(t.designer, "designMotion", 1))).not.toContain("quality");
  });

  it("leaves a High model's default motions whole: they fit", async () => {
    const t = setupAi();
    const built = await t.service.buildModel(t.jobFor(), highInput());
    expect(built.skipped).toEqual([]);
  });
});

const highTheme = (text: string, extra: Partial<BuildEnvironmentInput> = {}): BuildEnvironmentInput => theme(text, { quality: "high", ...extra });
const worldAnswer = (world: unknown) => rawWorld((raw) => ((raw as { world?: unknown }).world = world));

describe("Build Environment at High quality", () => {
  it("builds the meadow's three pieces in High and the desert world's three pieces for an empty theme, with no AI call and no AI count", async () => {
    const t = setupAi();
    const built = await t.service.buildEnvironment(t.jobFor(), highTheme(""));

    expect(t.designer.calls).toHaveLength(0);
    expect(t.aiCount()).toBe(0);
    expect(t.builds).toHaveLength(6);
    expect(t.builds.map((b) => b.label)).toEqual(Array(6).fill("Build Environment"));
    for (const [index, kind] of (["tree", "windmill", "rock"] as const).entries()) {
      expect(t.builds[index].body).toEqual({ recipe: sceneryRecipe(kind, "high"), motions: sceneryMotions(kind), palette: [...SAMPLE_PALETTE] });
    }
    for (const [index, piece] of WORLD_PIECES.entries()) {
      expect(t.builds[3 + index].body).toEqual({ recipe: worldRecipe(piece, "desert"), motions: { version: 1, motions: {} }, palette: [...SAMPLE_PALETTE] });
    }
    expect(built).toMatchObject({ sky: 0, field: 3, stripe: 4, density: "some", quality: "high", reused: false });
    expect(built.scenery[0]).toEqual({ kind: "tree", sha256: t.builds[0].key, size: 24_824, triangles: estimate(sceneryRecipe("tree", "high")).triangles, vertices: estimate(sceneryRecipe("tree", "high")).vertices });
    expect(built.world?.style).toBe("desert");
    for (const [index, piece] of WORLD_PIECES.entries()) {
      expect(built.world?.[piece]).toEqual({ sha256: t.builds[3 + index].key, size: 24_824, triangles: estimate(worldRecipe(piece, "desert")).triangles, vertices: estimate(worldRecipe(piece, "desert")).vertices });
    }
  });

  it("leaves a Standard environment as it was: three builds, no quality, no world", async () => {
    const t = setupAi();
    const built = await t.service.buildEnvironment(t.jobFor(), theme(""));
    expect(t.builds).toHaveLength(3);
    expect(Object.keys(built)).not.toContain("quality");
    expect(Object.keys(built)).not.toContain("world");
  });

  it("asks Claude for a High world with the quality in the request, uses the style it chose, and keeps it apart from the Standard answer", async () => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => worldAnswer("meadow")) });
    const built = await t.service.buildEnvironment(t.jobFor(), highTheme("a green valley"));

    expect(requestOf(t.designer, "designEnvironment")).toMatchObject({ theme: "a green valley", quality: "high" });
    expect(built.world?.style).toBe("meadow");
    expect(t.builds.slice(2).map((b) => (b.body.recipe.build as { style?: string }).style)).toEqual(["meadow", "meadow", "meadow"]);
    expect(piecesBuilt(t).slice(0, 2)).toEqual(["pine", "lamp"]);

    await t.service.buildEnvironment(t.jobFor(), theme("a green valley"));
    expect(environmentCalls(t.designer)).toHaveLength(2);
    expect(Object.keys(requestOf(t.designer, "designEnvironment", 1))).not.toContain("quality");
    await t.service.buildEnvironment(t.jobFor(), highTheme("a green valley"));
    expect(environmentCalls(t.designer)).toHaveLength(2);
  });

  it.each([
    ["no style", undefined],
    ["a style that is not ours", "arctic"],
    ["a number", 3],
  ])("builds the desert when Claude's answer has %s", async (_label, world) => {
    const t = setupAi({ designer: scriptedDesigner(undefined, undefined, () => worldAnswer(world)) });
    const built = await t.service.buildEnvironment(t.jobFor(), highTheme("somewhere"));
    expect(built.world?.style).toBe("desert");
  });

  it("says it reused the result only when Claude was not asked and every piece, scenery and world, came from the cache", async () => {
    const t = setupAi();
    expect((await t.service.buildEnvironment(t.jobFor(), highTheme(""))).reused).toBe(false);
    expect((await t.service.buildEnvironment(t.jobFor(), highTheme(""))).reused).toBe(true);
  });

  it("fails the step with the Blender sentence, and builds no more, when a piece of the world fails", async () => {
    const error = new NodeError("Build Environment: The Blender service did not answer. Try again.");
    const t = setupAi({ failBuild: { at: 5, error } });
    expect(await failure(t.service.buildEnvironment(t.jobFor(), highTheme("")))).toBe(error);
    expect(t.builds).toHaveLength(5);
  });
});
