// The builder service: from what Build Model asks for to a stored, animated GLB. With every box empty and a kind chosen it needs no AI at
// all: the kit's default recipe and the role's default motions go to Blender. With a description, Claude designs the look (cached, counted
// against the daily AI limits, shaped to Play's clock) and the answer is repaired before anything is built from it. It knows nothing about
// Firestore or Claude's vendor: those are the ports it is given, so every rule here is tested with fakes.
import { cleanPrompt } from "@/lib/ai/answer";
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES } from "@/lib/ai/anthropic";
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { AiRefusedError, AiUnavailableError, type DesignReply, type Designer } from "@/lib/ai/types";
import type { BlenderService } from "@/lib/blender/types";
import { CLIPS_FOR_ROLE, KIT, type ClipKey, type ModelKind, type Quality, WORLD_PIECES } from "@/lib/builder/kinds";
import { designKey, environmentKey, motionKey } from "@/lib/builder/keys";
import { freeformClipsOf, freeformRoleOf, isFreeformRecipe, repairFreeform, type FreeformRecipe } from "@/lib/builder/freeform";
import type { RecipeCache } from "@/lib/builder/ports";
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_WORLD,
  defaultHighRecipe,
  defaultMotions,
  defaultRecipe,
  type EnvironmentDesign,
  fitToBudget,
  jointsOf,
  type ModelRecipe,
  type MotionRecipe,
  sceneryMotions,
  sceneryRecipe,
  type Skipped,
  worldRecipe,
} from "@/lib/builder/recipes";
import { fitMotionsToMeshes, repairEnvironment, repairModelRecipe, repairMotions } from "@/lib/builder/repair";
import type { BuildEnvironmentInput, BuildModelInput, BuilderService, BuiltEnvironment, BuiltModel, BuiltPiece, BuiltWorld } from "@/lib/builder/types";
import { pictureForModel } from "@/lib/graph/image";
import { MIN_START_MS, RAN_OUT_OF_TIME, timeLeft } from "@/lib/graph/playTime";
import { NodeError } from "@/lib/graph/types";

/** What the AI half needs. Without it, any words in the step's boxes stop with the plain "did not answer" sentence. */
export interface BuilderAi {
  designer: Designer;
  /** The designs of kit models and of freeform ones; a freeform design has its own keys (the kind "freeform" is in them). */
  designs: RecipeCache<ModelRecipe | FreeformRecipe>;
  motions: RecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>;
  environments: RecipeCache<EnvironmentDesign>;
  limits: UsageLimits;
  /** Claude's model name: part of every cache key and stored with every answer. */
  modelId: string;
  perPerson: number;
  total: number;
}

export interface BuilderDeps {
  blender: BlenderService;
  now: () => number;
  ai?: BuilderAi;
  /** Where outcomes are logged: the step, the call, the outcome, counts and statuses, never the person's words or a recipe. */
  log?: (info: object) => void;
}

const STEP = "build-model";
const NO_ANSWER = "The AI service did not answer. Try again.";

type Call = "design" | "motion" | "environment";
// Each call belongs to a step, which is how its failures are logged and what every sentence it says starts with.
const STEP_OF: Record<Call, string> = { design: STEP, motion: STEP, environment: "build-environment" };
const LABEL_OF: Record<Call, string> = { design: "Build Model", motion: "Build Model", environment: "Build Environment" };

/** Anything but "high" is Standard: a graph saved before the Quality setting has none. */
const qualityOf = (quality: Quality | undefined): Quality => (quality === "high" ? "high" : "standard");

export function makeBuilderService(deps: BuilderDeps): BuilderService {
  const log = deps.log ?? (() => {});
  const say = (message: string) => new NodeError(`Build Model: ${message}`);

  /**
   * One call to Claude and what must happen around it. Play's clock first (no call is started that could not finish, and Claude gets what
   * fits), then one AI count before the call, so simultaneous requests cannot all slip under the limit. A refusal keeps the count (it used
   * the model); a service that did not answer, a surprise or a request that could not be put together gives it back. An answer that cannot
   * be repaired keeps the count too. `request` may throw a NodeError (a picture that cannot be read): that gives the count back.
   */
  async function askClaude<T>(
    ai: BuilderAi,
    job: { user: { uid: string }; deadline: number },
    call: Call,
    request: (timeoutMs: number) => Promise<DesignReply>,
    repair: (raw: unknown) => T | null,
  ): Promise<{ value: T; usage: DesignReply["usage"] }> {
    const step = STEP_OF[call];
    const problem = (message: string) => new NodeError(`${LABEL_OF[call]}: ${message}`);
    const left = timeLeft(job.deadline, deps.now());
    if (left < MIN_START_MS) {
      log({ step, call, outcome: "no-time" });
      throw problem(RAN_OUT_OF_TIME);
    }
    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.floor(left / (MAX_RETRIES + 1)));

    const day = dayOf(deps.now());
    const taken = await ai.limits.take(job.user.uid, day, { perPerson: ai.perPerson, total: ai.total });
    if (taken !== "ok") {
      log({ step, call, outcome: taken });
      throw problem(taken === "person-limit" ? "You have used today's AI answers. Try again tomorrow." : "The AI is busy today. Try again tomorrow.");
    }

    let reply: DesignReply;
    try {
      reply = await request(timeoutMs);
    } catch (error) {
      if (error instanceof AiRefusedError) {
        log({ step, call, outcome: "refused" });
        throw problem("The AI declined this request. Try different words.");
      }
      await ai.limits.give(job.user.uid, day);
      if (error instanceof NodeError) {
        log({ step, call, outcome: "picture" });
        throw error;
      }
      if (error instanceof AiUnavailableError) log({ step, call, outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }), ...(error.detail === undefined ? {} : { detail: error.detail }) });
      else log({ step, call, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      throw problem(NO_ANSWER);
    }

    const value = repair(reply.raw);
    if (value === null) {
      log({ step, call, outcome: "bad-answer", ...reply.usage });
      throw problem("The AI could not build this. Try different words.");
    }
    return { value, usage: reply.usage };
  }

  /** The look of the model from Claude, or from the cache. `asked` is true when Claude was asked. */
  async function design(
    ai: BuilderAi,
    job: Parameters<BuilderService["buildModel"]>[0],
    input: BuildModelInput,
    description: string,
  ): Promise<{ recipe: ModelRecipe; asked: boolean }> {
    const wanted = input.kind === "auto" || input.kind === "freeform" ? null : input.kind;
    const quality = qualityOf(input.quality);
    const key = await designKey({
      model: ai.modelId,
      uid: job.user.uid,
      description,
      kind: input.kind,
      role: input.role,
      pictureSha: input.picture?.sha256 ?? null,
      quality,
    });

    const found = await ai.designs.get(key);
    if (found && !isFreeformRecipe(found.value)) {
      log({ step: STEP, call: "design", outcome: "reused" });
      return { recipe: found.value, asked: false };
    }

    const { value: recipe, usage } = await askClaude(
      ai,
      job,
      "design",
      async (timeoutMs) => {
        let picture: Uint8Array | null = null;
        if (input.picture) {
          const small = await pictureForModel(input.picture.bytes);
          if (!small.ok) throw say(small.error);
          picture = small.jpeg;
        }
        // only High says its quality, so a Standard request is what it always was
        return ai.designer.designModel({ description, role: input.role, kind: wanted, picture, ...(quality === "high" ? { quality } : {}), timeoutMs });
      },
      (raw) => {
        const repaired = repairModelRecipe(raw, { kind: wanted, quality });
        return repaired.ok ? repaired.recipe : null;
      },
    );

    try {
      await ai.designs.put(key, { value: recipe, model: ai.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    } catch {
      log({ step: STEP, call: "design", outcome: "cache-write-failed" }); // the answer is good and paid for: build it, even if it cannot be kept
    }
    log({ step: STEP, call: "design", outcome: "answered", ...usage });
    return { recipe, asked: true };
  }

  /** The freeform model from Claude, or from the cache. `asked` is true when Claude was asked. */
  async function designFreeformModel(
    ai: BuilderAi,
    job: Parameters<BuilderService["buildModel"]>[0],
    input: BuildModelInput,
    description: string,
  ): Promise<{ recipe: FreeformRecipe; asked: boolean }> {
    const key = await designKey({ model: ai.modelId, uid: job.user.uid, description, kind: "freeform", role: input.role, pictureSha: input.picture?.sha256 ?? null, ...(input.style ? { style: input.style } : {}) });
    const found = await ai.designs.get(key);
    if (found && isFreeformRecipe(found.value)) {
      log({ step: STEP, call: "design", outcome: "reused" });
      return { recipe: found.value, asked: false };
    }

    const { value: recipe, usage } = await askClaude(
      ai,
      job,
      "design",
      async (timeoutMs) => {
        let picture: Uint8Array | null = null;
        if (input.picture) {
          const small = await pictureForModel(input.picture.bytes);
          if (!small.ok) throw say(small.error);
          picture = small.jpeg;
        }
        return ai.designer.designFreeform({ description, role: input.role, picture, ...(input.style ? { style: input.style } : {}), timeoutMs });
      },
      (raw) => {
        const repaired = repairFreeform(raw);
        return repaired.ok ? repaired.recipe : null;
      },
    );

    try {
      await ai.designs.put(key, { value: recipe, model: ai.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    } catch {
      log({ step: STEP, call: "design", outcome: "cache-write-failed" });
    }
    log({ step: STEP, call: "design", outcome: "answered", ...usage });
    return { recipe, asked: true };
  }

  /**
   * A freeform model: designed from the words (there is no kit default to fall back on), then built twice, for the PC and for the phone (two cached
   * worker calls; the worker fits each to its triangle budget). It has no motions of its own: the worker puts the stock clips of its role on it
   * (a hero runs and jumps, a collectible turns, an obstacle stands still).
   */
  async function buildFreeform(job: Parameters<BuilderService["buildModel"]>[0], input: BuildModelInput, description: string): Promise<BuiltModel> {
    if (description === "") throw say("describe it first.");
    if (!deps.ai) throw say(NO_ANSWER);
    const { recipe, asked } = await designFreeformModel(deps.ai, job, input, description);
    const palette = [...input.palette];
    const role = freeformRoleOf(input.role);
    const clips = freeformClipsOf(input.role);
    const pc = await deps.blender.build(job, { label: "Build Model", body: { recipe, palette, role, target: "pc", clips } });
    // A phone variant that cannot be built (no time left, the day's builds used, a worker that did not answer) leaves the PC model: the Android export then
    // takes the PC file, which is what a run with no variant does.
    let mobile: Awaited<ReturnType<BlenderService["build"]>> | null = null;
    try {
      mobile = await deps.blender.build(job, { label: "Build Model", body: { recipe, palette, role, target: "mobile", clips } });
    } catch (error) {
      if (!(error instanceof NodeError)) throw error;
      log({ step: STEP, call: "mobile", outcome: "skipped" });
    }
    return {
      sha256: pc.sha256,
      size: pc.size,
      kind: "freeform",
      parts: pc.parts,
      triangles: pc.triangles,
      clips: pc.clips,
      summary: recipe.summary !== "" ? recipe.summary : "A custom model.",
      skipped: [],
      reused: !asked && pc.reused && (mobile?.reused ?? true),
      ...(pc.vertices === undefined ? {} : { vertices: pc.vertices }),
      ...(mobile ? { mobile: { sha256: mobile.sha256, size: mobile.size, triangles: mobile.triangles } } : {}),
    };
  }

  /**
   * The motions of the model: Claude's for the clips whose boxes have words (cached by kind, joints and every clip's text), the kit's
   * default for the rest. `skipped` is what Claude asked for on joints the model lacks. `asked` is true when Claude was asked.
   */
  async function motion(
    ai: BuilderAi,
    job: Parameters<BuilderService["buildModel"]>[0],
    input: BuildModelInput,
    recipe: ModelRecipe,
    kind: ModelKind,
  ): Promise<{ motions: MotionRecipe; skipped: Skipped[]; asked: boolean }> {
    const clips = CLIPS_FOR_ROLE[input.role];
    // Every clip the role has, "" for an empty box: the key says what each box said, so moving words between boxes is another key.
    const texts = Object.fromEntries(clips.map((clip) => [clip, cleanPrompt(input.motions[clip])])) as Record<ClipKey, string>;
    const wanted = clips.filter((clip) => texts[clip] !== "");
    const joints = jointsOf(recipe);
    const quality = qualityOf(input.quality);
    const key = await motionKey({ model: ai.modelId, uid: job.user.uid, kind, joints, texts, quality });

    let answered: { motions: MotionRecipe; skipped: Skipped[] };
    let asked = false;
    const found = await ai.motions.get(key);
    if (found) {
      log({ step: STEP, call: "motion", outcome: "reused" });
      answered = found.value;
    } else {
      const { value, usage } = await askClaude(
        ai,
        job,
        "motion",
        (timeoutMs) => ai.designer.designMotion({ kind, joints, texts: Object.fromEntries(wanted.map((clip) => [clip, texts[clip]])), ...(quality === "high" ? { quality } : {}), timeoutMs }),
        (raw) => {
          const repaired = repairMotions(raw, { recipe, clips: wanted });
          return repaired.ok ? { motions: repaired.motions, skipped: repaired.skipped } : null;
        },
      );
      try {
        await ai.motions.put(key, { value, model: ai.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      } catch {
        log({ step: STEP, call: "motion", outcome: "cache-write-failed" });
      }
      log({ step: STEP, call: "motion", outcome: "answered", ...usage });
      answered = value;
      asked = true;
    }

    // The clips whose boxes are empty take the kit's default motion; the others take Claude's.
    const merged = defaultMotions(recipe, clips);
    for (const clip of wanted) {
      const mine = answered.motions.motions[clip];
      if (mine) merged.motions[clip] = mine;
    }
    return { motions: merged, skipped: answered.skipped, asked };
  }

  /** The world from Claude, or from the cache. `asked` is true when Claude was asked. */
  async function designWorld(
    ai: BuilderAi,
    job: Parameters<BuilderService["buildEnvironment"]>[0],
    theme: string,
    quality: Quality,
  ): Promise<{ design: EnvironmentDesign; asked: boolean }> {
    const step = STEP_OF.environment;
    const key = await environmentKey({ model: ai.modelId, uid: job.user.uid, theme, quality });
    const found = await ai.environments.get(key);
    if (found) {
      log({ step, call: "environment", outcome: "reused" });
      return { design: found.value, asked: false };
    }

    const { value: design, usage } = await askClaude(
      ai,
      job,
      "environment",
      (timeoutMs) => ai.designer.designEnvironment({ theme, ...(quality === "high" ? { quality } : {}), timeoutMs }),
      (raw) => {
        const repaired = repairEnvironment(raw, { quality });
        return repaired.ok ? repaired.design : null;
      },
    );

    try {
      await ai.environments.put(key, { value: design, model: ai.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
    } catch {
      log({ step, call: "environment", outcome: "cache-write-failed" });
    }
    log({ step, call: "environment", outcome: "answered", ...usage });
    return { design, asked: true };
  }

  return {
    async buildModel(job, input) {
      const description = cleanPrompt(input.description);
      const quality = qualityOf(input.quality);
      const high = quality === "high";
      // Only the boxes of this role's own clips count: a Loop box left behind on a hero is not a motion it has.
      const clips = CLIPS_FOR_ROLE[input.role];
      const motionWords = clips.some((clip) => cleanPrompt(input.motions[clip]) !== "");

      if (input.kind === "freeform") return buildFreeform(job, input, description);
      const setting = input.kind;
      if (setting === "auto" && description === "") throw say("describe it first, or pick a kind.");

      // Auto with an empty description was refused above, so a kind is chosen when there is no description to design from.
      let recipe: ModelRecipe;
      let askedLook = false;
      if (description !== "") {
        if (!deps.ai) throw say(NO_ANSWER);
        ({ recipe, asked: askedLook } = await design(deps.ai, job, input, description));
      } else {
        const chosen = setting === "auto" ? "biped" : setting;
        recipe = high ? defaultHighRecipe(chosen) : defaultRecipe(chosen);
      }
      // A High recipe goes through the budget fit before it is built (the repair did it for Claude's, this is for every way here).
      if (high) {
        const fitted = fitToBudget(recipe);
        if (!fitted) throw say("This does not fit the High limits. Try different words.");
        recipe = fitted;
      }
      // The repair and the check allow only the four model kinds until the scenery kit exists.
      const kind = recipe.kind as ModelKind;

      let motions: MotionRecipe;
      let skipped: Skipped[] = [];
      let askedMotion = false;
      if (motionWords) {
        if (!deps.ai) throw say(NO_ANSWER);
        ({ motions, skipped, asked: askedMotion } = await motion(deps.ai, job, input, recipe, kind));
      } else {
        motions = defaultMotions(recipe, clips);
      }
      // A High model has one mesh for each joint that moves: the tracks that would need more than the kind has are dropped, and said so.
      if (high) {
        const fitted = fitMotionsToMeshes(recipe, motions);
        motions = fitted.motions;
        skipped = [...skipped, ...fitted.skipped];
      }

      const built = await deps.blender.build(job, { label: "Build Model", body: { recipe, motions, palette: [...input.palette] } });
      return {
        sha256: built.sha256,
        size: built.size,
        kind,
        parts: built.parts,
        triangles: built.triangles,
        clips: built.clips,
        summary: recipe.summary !== "" ? recipe.summary : KIT.kinds[kind].summary,
        skipped,
        reused: !askedLook && !askedMotion && built.reused,
        ...(high ? { quality, ...(built.vertices === undefined ? {} : { vertices: built.vertices }) } : {}),
      };
    },

    async buildEnvironment(job, input: BuildEnvironmentInput): Promise<BuiltEnvironment> {
      const theme = cleanPrompt(input.theme);
      const quality = qualityOf(input.quality);
      const high = quality === "high";

      // An empty theme builds the meadow (and, in High, the desert world around it) with no AI at all.
      let design: EnvironmentDesign = DEFAULT_ENVIRONMENT;
      let asked = false;
      if (theme !== "") {
        if (!deps.ai) throw new NodeError(`Build Environment: ${NO_ANSWER}`);
        ({ design, asked } = await designWorld(deps.ai, job, theme, quality));
      }

      // One worker job for each piece, one after another; the first that fails fails the step with its own sentence.
      const piece = (built: { sha256: string; size: number; triangles: number; vertices?: number }): BuiltPiece => ({
        sha256: built.sha256,
        size: built.size,
        triangles: built.triangles,
        ...(built.vertices === undefined ? {} : { vertices: built.vertices }),
      });
      const scenery: BuiltEnvironment["scenery"] = [];
      let everyPieceReused = true;
      for (const kind of design.scenery) {
        const built = await deps.blender.build(job, { label: "Build Environment", body: { recipe: sceneryRecipe(kind, quality), motions: sceneryMotions(kind), palette: [...input.palette] } });
        scenery.push({ kind, ...piece(built) });
        everyPieceReused &&= built.reused;
      }

      let world: BuiltWorld | undefined;
      if (high) {
        const style = design.world ?? DEFAULT_WORLD;
        const pieces = {} as Record<(typeof WORLD_PIECES)[number], BuiltPiece>;
        for (const name of WORLD_PIECES) {
          const built = await deps.blender.build(job, { label: "Build Environment", body: { recipe: worldRecipe(name, style), motions: { version: 1, motions: {} }, palette: [...input.palette] } });
          pieces[name] = piece(built);
          everyPieceReused &&= built.reused;
        }
        world = { style, ...pieces };
      }
      return {
        sky: design.sky,
        field: design.field,
        stripe: design.stripe,
        density: input.density,
        scenery,
        reused: !asked && everyPieceReused,
        ...(world ? { quality, world } : {}),
      };
    },
  };
}
