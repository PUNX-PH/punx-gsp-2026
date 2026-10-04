// The Describe Game service: the rules around the model. It cleans the prompt, answers from the cache when it can, counts the
// new answer against the daily limits before asking, sends the model a small copy of the picture, checks and repairs what
// comes back, stores it, and says in plain words (as a NodeError) when it cannot. It knows nothing about Firestore or the
// model's vendor: those are the ports it is given, so every rule here is tested with fakes.
import { cleanPrompt, parseAnswer } from "@/lib/ai/answer";
import { answerKey, dayOf } from "@/lib/ai/key";
import type { AnswerCache, UsageLimits } from "@/lib/ai/ports";
import { AiRefusedError, AiUnavailableError, type DescribeGameModel, type DescribeGameService } from "@/lib/ai/types";
import { pictureForModel } from "@/lib/graph/image";
import { NodeError } from "@/lib/graph/types";

export interface DescribeGameDeps {
  cache: AnswerCache;
  limits: UsageLimits;
  model: DescribeGameModel;
  /** The model's name: part of every cache key and stored with every answer. */
  modelId: string;
  perPerson: number;
  total: number;
  now: () => number;
  /** Where outcomes are logged: the step, the outcome and token counts, never the prompt, the picture, the answer or a message. */
  log?: (info: object) => void;
}

const STEP = "describe-game";

export function makeDescribeGameService(deps: DescribeGameDeps): DescribeGameService {
  const log = deps.log ?? (() => {});
  const say = (message: string) => new NodeError(`Describe Game: ${message}`);

  return {
    async describe(user, input) {
      const prompt = cleanPrompt(input.prompt);
      if (prompt === "") throw say("Describe your game first."); // nothing was left of it once the control characters went

      const key = await answerKey({ model: deps.modelId, uid: user.uid, prompt, pictureSha: input.picture?.sha256 ?? null });
      const found = await deps.cache.get(key);
      if (found) {
        log({ step: STEP, outcome: "reused" });
        return { answer: found.answer, reused: true };
      }

      // Counted before the call, so simultaneous requests cannot all slip under the limit.
      const day = dayOf(deps.now());
      const taken = await deps.limits.take(user.uid, day, { perPerson: deps.perPerson, total: deps.total });
      if (taken !== "ok") {
        log({ step: STEP, outcome: taken });
        throw say(taken === "person-limit" ? "You have used today's AI answers. Try again tomorrow." : "The AI is busy today. Try again tomorrow.");
      }

      let jpeg: Uint8Array | null = null;
      if (input.picture) {
        const small = await pictureForModel(input.picture.bytes);
        if (!small.ok) {
          await deps.limits.give(user.uid, day);
          log({ step: STEP, outcome: "picture" });
          throw say(small.error);
        }
        jpeg = small.jpeg;
      }

      let reply: Awaited<ReturnType<DescribeGameModel["ask"]>>;
      try {
        reply = await deps.model.ask({ prompt, picture: jpeg });
      } catch (error) {
        // A refusal still used the model, so it stays counted; anything else was not the person's doing, so the place is given back.
        if (error instanceof AiRefusedError) {
          log({ step: STEP, outcome: "refused" });
          throw say("The AI declined this request. Try different words.");
        }
        await deps.limits.give(user.uid, day);
        if (error instanceof AiUnavailableError) log({ step: STEP, outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }) });
        else log({ step: STEP, outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
        throw say("The AI service did not answer. Try again.");
      }

      const parsed = parseAnswer(reply.raw);
      if (!parsed.ok) {
        log({ step: STEP, outcome: "bad-answer", ...reply.usage });
        throw say("The AI could not make a playable game from this. Try different words.");
      }

      try {
        await deps.cache.put(key, {
          answer: parsed.answer,
          model: deps.modelId,
          createdAt: deps.now(),
          inputTokens: reply.usage.inputTokens,
          outputTokens: reply.usage.outputTokens,
        });
      } catch {
        log({ step: STEP, outcome: "cache-write-failed" }); // the answer is good and paid for: give it, even if it cannot be kept
      }
      log({ step: STEP, outcome: "answered", ...reply.usage });
      return { answer: parsed.answer, reused: false };
    },
  };
}
