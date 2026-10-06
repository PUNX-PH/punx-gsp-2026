import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { dayOf } from "@/lib/ai/key";
import { MemoryUsageLimits, ScriptedDesigner } from "@/lib/ai/memory";
import { AiRefusedError, AiUnavailableError } from "@/lib/ai/types";
import { buildKey } from "@/lib/blender/key";
import type { BlenderJob, BlenderService, BuiltResult } from "@/lib/blender/types";
import type { ModelKind } from "@/lib/builder/kinds";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import { type BuildBody, clipsOf, defaultRecipe, type ModelRecipe, type MotionRecipe, type Skipped } from "@/lib/builder/recipes";
import { makeBuilderService } from "@/lib/builder/service";
import type { BuildModelInput } from "@/lib/builder/types";
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
const scriptedDesigner = (raw: () => unknown = () => rawModel()) => new ScriptedDesigner({ designModel: async () => ({ raw: raw(), usage: USAGE }) });
const designCalls = (designer: ScriptedDesigner) => designer.calls.filter((call) => call.method === "designModel");

class FailingCache<T> extends MemoryRecipeCache<T> {
  override async put(): Promise<void> {
    throw new Error("firestore is down");
  }
}

function setupAi(options: { designer?: ScriptedDesigner; perPerson?: number; total?: number; reverseKeys?: boolean; failingDesignCache?: boolean } = {}) {
  const designs = options.failingDesignCache ? new FailingCache<ModelRecipe>() : new MemoryRecipeCache<ModelRecipe>({ reverseKeys: options.reverseKeys });
  const motions = new MemoryRecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>();
  const limits = new MemoryUsageLimits();
  const designer = options.designer ?? scriptedDesigner();
  const clock = { ms: Date.UTC(2026, 9, 6, 12) };
  const logs: object[] = [];
  const seen = new Set<string>();
  const builds: { job: BlenderJob; body: BuildBody; key: string }[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(j, request) {
      const key = await buildKey({ graphId: j.graphId, body: request.body });
      const reused = seen.has(key);
      seen.add(key);
      builds.push({ job: j, body: request.body, key });
      return { sha256: SHA, size: 24_824, triangles: 180, parts: 15, clips: clipsOf(request.body.motions), reused };
    },
  };
  const service = makeBuilderService({
    blender,
    now: () => clock.ms,
    log: (info) => logs.push(info),
    ai: { designer, designs, motions, limits, modelId: "claude-sonnet-5-5", perPerson: options.perPerson ?? 30, total: options.total ?? 300 },
  });
  const jobFor = (left = 200_000, user = job.user): BlenderJob => ({ ...job, user, deadline: clock.ms + left });
  const aiCount = () => limits.counts.get(`site_${dayOf(clock.ms)}`) ?? 0;
  return { service, designer, designs, limits, logs, builds, clock, jobFor, aiCount };
}

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
