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
import { CLIPS_FOR_ROLE, KIT, type ModelKind } from "@/lib/builder/kinds";
import { designKey } from "@/lib/builder/keys";
import type { RecipeCache } from "@/lib/builder/ports";
import { defaultMotions, defaultRecipe, type ModelRecipe, type MotionRecipe, type Skipped } from "@/lib/builder/recipes";
import { repairModelRecipe } from "@/lib/builder/repair";
import type { BuildModelInput, BuilderService } from "@/lib/builder/types";
import { pictureForModel } from "@/lib/graph/image";
import { MIN_START_MS, RAN_OUT_OF_TIME, timeLeft } from "@/lib/graph/playTime";
import { NodeError } from "@/lib/graph/types";

/** What the AI half needs. Without it, any words in the step's boxes stop with the plain "did not answer" sentence. */
export interface BuilderAi {
  designer: Designer;
  designs: RecipeCache<ModelRecipe>;
  motions: RecipeCache<{ motions: MotionRecipe; skipped: Skipped[] }>;
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
    call: "design" | "motion",
    request: (timeoutMs: number) => Promise<DesignReply>,
    repair: (raw: unknown) => T | null,
  ): Promise<{ value: T; usage: DesignReply["usage"] }> {
    const left = timeLeft(job.deadline, deps.now());
    if (left < MIN_START_MS) {
      log({ step: STEP, call, outcome: "no-time" });
      throw say(RAN_OUT_OF_TIME);
    }
    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.floor(left / (MAX_RETRIES + 1)));

    const day = dayOf(deps.now());
    const taken = await ai.limits.take(job.user.uid, day, { perPerson: ai.perPerson, total: ai.total });
    if (taken !== "ok") {
      log({ step: STEP, call, outcome: taken });
      throw say(taken === "person-limit" ? "You have used today's AI answers. Try again tomorrow." : "The AI is busy today. Try again tomorrow.");
    }

    let reply: DesignReply;
    try {
      reply = await request(timeoutMs);
    } catch (error) {
      if (error instanceof AiRefusedError) {
        log({ step: STEP, call, outcome: "refused" });
        throw say("The AI declined this request. Try different words.");
      }
      await ai.limits.give(job.user.uid, day);
      if (error instanceof NodeError) {
        log({ step: STEP, call, outcome: "picture" });
        throw error;
      }
      if (error instanceof AiUnavailableError) log({ step: STEP, call, outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }) });
      else log({ step: STEP, call, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      throw say(NO_ANSWER);
    }

    const value = repair(reply.raw);
    if (value === null) {
      log({ step: STEP, call, outcome: "bad-answer", ...reply.usage });
      throw say("The AI could not build this. Try different words.");
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
    const wanted = input.kind === "auto" ? null : input.kind;
    const key = await designKey({
      model: ai.modelId,
      uid: job.user.uid,
      description,
      kind: input.kind,
      role: input.role,
      pictureSha: input.picture?.sha256 ?? null,
    });

    const found = await ai.designs.get(key);
    if (found) {
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
        return ai.designer.designModel({ description, role: input.role, kind: wanted, picture, timeoutMs });
      },
      (raw) => {
        const repaired = repairModelRecipe(raw, { kind: wanted });
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

  return {
    async buildModel(job, input) {
      const description = cleanPrompt(input.description);
      // Only the boxes of this role's own clips count: a Loop box left behind on a hero is not a motion it has.
      const clips = CLIPS_FOR_ROLE[input.role];
      const motionWords = clips.some((clip) => cleanPrompt(input.motions[clip]) !== "");

      if (input.kind === "auto" && description === "") throw say("describe it first, or pick a kind.");

      // Auto with an empty description was refused above, so a kind is chosen when there is no description to design from.
      let recipe: ModelRecipe;
      let asked = false;
      if (description !== "") {
        if (!deps.ai) throw say(NO_ANSWER);
        ({ recipe, asked } = await design(deps.ai, job, input, description));
      } else {
        recipe = defaultRecipe(input.kind === "auto" ? "biped" : input.kind);
      }
      if (motionWords) throw say(NO_ANSWER); // the AI half for motions is not here yet

      const motions = defaultMotions(recipe, clips);
      const built = await deps.blender.build(job, { label: "Build Model", body: { recipe, motions, palette: [...input.palette] } });
      // The repair and the check allow only the four model kinds until the scenery kit exists.
      const kind = recipe.kind as ModelKind;
      return {
        sha256: built.sha256,
        size: built.size,
        kind,
        parts: built.parts,
        triangles: built.triangles,
        clips: built.clips,
        summary: recipe.summary !== "" ? recipe.summary : KIT.kinds[kind].summary,
        skipped: [],
        reused: !asked && built.reused,
      };
    },
  };
}
