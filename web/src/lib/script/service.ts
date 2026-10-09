// The script service: from words (and a picture) to a checked Lua game script and the models it needs. Claude writes the script through the ScriptAuthor
// port; the answer is checked (size, syntax, the names the player removed, a callback to run) before anyone sees it, with one retry that tells Claude
// why the first was rejected. There is no playtest on the server: only the player can run a script, and it runs it in its own sandbox. Cached per
// person, counted against the daily AI limits, shaped to Play's clock. It knows nothing about Firestore or Claude's vendor: those are the ports it is
// given, so every rule here is tested with fakes.
import { cleanPrompt } from "@/lib/ai/answer";
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES } from "@/lib/ai/anthropic";
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { AiRefusedError, AiUnavailableError, type DesignReply } from "@/lib/ai/types";
import { type ArtStyle, repairStyle, repairWorld, type WorldPlan } from "@/lib/builder/world";
import type { RecipeCache } from "@/lib/builder/ports";
import { ASSET_ROLES } from "@/lib/engine/prompts";
import type { AssetRequest, AssetRole } from "@/lib/engine/service";
import { paintingPalette } from "@/lib/graph/palette";
import { MIN_START_MS, RAN_OUT_OF_TIME, timeLeft } from "@/lib/graph/playTime";
import { MAX_PROMPT_CHARACTERS } from "@/lib/graph/registry";
import { NodeError } from "@/lib/graph/types";
import { PRIMITIVE_KINDS, SCRIPT_LIMITS } from "./api";
import type { ScriptAuthor } from "./author";
import { checkScript } from "./check";
import { scriptKey } from "./keys";

/** What is stored and returned: the script, the game's five colors, what Claude said it left out, and the models to make. */
export interface StoredScript {
  script: string;
  /** Five #rrggbb colors; any Claude left out or got wrong is the sample palette's. */
  palette: string[];
  leftOut: string;
  assets: AssetRequest[];
  /** One art style for every model of the game. */
  style: ArtStyle;
  /** The sky, the ground and the scenery around the field, or null when Claude planned none. */
  world: WorldPlan | null;
}

/** What the cache holds. */
export type CachedScript = StoredScript;

export interface ScriptDeps {
  author: ScriptAuthor;
  cache: RecipeCache<CachedScript>;
  limits: UsageLimits;
  /** Claude's model name: part of every cache key and stored with every answer. */
  modelId: string;
  perPerson: number;
  total: number;
  now: () => number;
  /** Where outcomes are logged: the step, the outcome, counts and statuses, never the person's words or a script. */
  log?: (info: object) => void;
}

export interface ScriptJob {
  user: { uid: string };
  /** The moment Play must be finished by (graph/playTime.ts). */
  deadline: number;
}

export interface ScriptInput {
  description: string;
  picture: { sha256: string; bytes: Uint8Array } | null;
  /** Names of the models wired into the step. */
  models: string[];
  /**
   * How many times the person has pressed Try again (0 for none). It is part of the cache key: a new number asks Claude again once, and every Play with
   * the same number reuses that answer, so nothing has to be reset and a repeated Play costs nothing.
   */
  attempt: number;
  /** The view the person chose (first, third, top or side); absent or auto leaves it to Claude. */
  perspective?: string;
}

export interface ScriptService {
  /** `asked` is true when Claude was asked, false when the script came from the cache. */
  create(job: ScriptJob, input: ScriptInput): Promise<StoredScript & { asked: boolean }>;
}

const LABEL = "Describe Game";
const NO_ANSWER = "The AI service did not answer. Try again.";
const BAD_ANSWER = "The AI could not build this game. Try different words.";
const MAX_LEFT_OUT = 200;
const MAX_ASSET_DESCRIPTION = 300;
const MODEL_NAME = /^[a-z][a-zA-Z0-9]{0,15}$/;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Whether the script writes the name as a string, which is how it spawns a model ("hero" or 'hero'). */
const spawnsByName = (script: string, name: string): boolean => script.includes(`"${name}"`) || script.includes(`'${name}'`);

/**
 * The models Claude asked for, kept only when the name is allowed and is not a primitive's, the script uses it, and the role is real; one per
 * name, at most the cap. A model nobody spawns is never built: building costs time and an AI count.
 */
function checkedAssets(raw: unknown, script: string): AssetRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: AssetRequest[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.entity !== "string" || typeof item.description !== "string") continue;
    if (!MODEL_NAME.test(item.entity) || (PRIMITIVE_KINDS as readonly string[]).includes(item.entity) || !spawnsByName(script, item.entity)) continue;
    if (!(ASSET_ROLES as readonly string[]).includes(item.role as string)) continue;
    if (out.some((a) => a.entity === item.entity)) continue;
    // every model is freeform: the kit `kind` is no longer asked for (the field is kept for the rules path, and is not used here)
    out.push({ entity: item.entity, role: item.role as AssetRole, kind: "prop", description: cleanPrompt(item.description).slice(0, MAX_ASSET_DESCRIPTION) });
    if (out.length === SCRIPT_LIMITS.assets) break;
  }
  return out;
}

/** A stored script back as a checked one, or null when what the cache holds does not pass the check any more (it is then asked again). */
function readCached(value: CachedScript): StoredScript | null {
  if (!isObject(value) || typeof value.script !== "string" || !checkScript(value.script).ok) return null;
  return {
    script: value.script,
    palette: paintingPalette(Array.isArray(value.palette) ? value.palette : []),
    leftOut: typeof value.leftOut === "string" ? value.leftOut : "",
    assets: Array.isArray(value.assets) ? value.assets : [],
    style: repairStyle(value.style),
    world: value.world === undefined || value.world === null ? null : repairWorld(value.world),
  };
}

type Read = { ok: false; reason: string } | { ok: true; stored: StoredScript };

export function makeScriptService(deps: ScriptDeps): ScriptService {
  const log = deps.log ?? (() => {});
  const problem = (message: string) => new NodeError(`${LABEL}: ${message}`);

  /** One call to Claude and what must happen around it: Play's clock, one AI count before the call, the count given back when no answer came. */
  async function ask(job: ScriptJob, request: (timeoutMs: number) => Promise<DesignReply>): Promise<DesignReply> {
    const left = timeLeft(job.deadline, deps.now());
    if (left < MIN_START_MS) {
      log({ step: "describe-game", call: "script", outcome: "no-time" });
      throw problem(RAN_OUT_OF_TIME);
    }
    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.floor(left / (MAX_RETRIES + 1)));
    const day = dayOf(deps.now());
    const taken = await deps.limits.take(job.user.uid, day, { perPerson: deps.perPerson, total: deps.total });
    if (taken !== "ok") {
      log({ step: "describe-game", call: "script", outcome: taken });
      throw problem(taken === "person-limit" ? "You have used today's AI answers. Try again tomorrow." : "The AI is busy today. Try again tomorrow.");
    }
    try {
      return await request(timeoutMs);
    } catch (error) {
      if (error instanceof AiRefusedError) {
        log({ step: "describe-game", call: "script", outcome: "refused" });
        throw problem("The AI declined this request. Try different words.");
      }
      await deps.limits.give(job.user.uid, day);
      if (error instanceof AiUnavailableError) log({ step: "describe-game", call: "script", outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }), ...(error.detail === undefined ? {} : { detail: error.detail }) });
      else log({ step: "describe-game", call: "script", outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      throw problem(NO_ANSWER);
    }
  }

  /** The reply as a checked script, or the reason it could not be used (a sentence Claude can act on in its one retry). */
  function read(reply: DesignReply): Read {
    if (!isObject(reply.raw) || typeof reply.raw.script !== "string") return { ok: false, reason: 'Your answer had no "script" holding the whole Lua program as text.' };
    const script = reply.raw.script;
    const checked = checkScript(script);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const leftOut = typeof reply.raw.leftOut === "string" ? cleanPrompt(reply.raw.leftOut).slice(0, MAX_LEFT_OUT) : "";
    const palette = paintingPalette(Array.isArray(reply.raw.palette) ? reply.raw.palette : []);
    return { ok: true, stored: { script, palette, leftOut, assets: checkedAssets(reply.raw.assets, script), style: repairStyle(reply.raw.style), world: repairWorld(reply.raw.world) } };
  }

  return {
    async create(job, input) {
      // The step already limits the words; a caller that does not gets the same limit here, before anything is keyed or sent.
      const description = Array.from(cleanPrompt(input.description)).slice(0, MAX_PROMPT_CHARACTERS).join("");
      if (description === "") throw problem("describe the game you want.");

      const key = await scriptKey({ model: deps.modelId, uid: job.user.uid, description, pictureSha: input.picture?.sha256 ?? null, models: input.models, attempt: input.attempt, perspective: input.perspective });
      const found = await deps.cache.get(key);
      const cached = found ? readCached(found.value) : null;
      if (cached) {
        log({ step: "describe-game", call: "script", outcome: "reused" });
        return { ...cached, asked: false };
      }

      const author = (retryReason?: string) => (timeoutMs: number) =>
        deps.author.author({ description, picture: input.picture?.bytes ?? null, models: input.models, retryReason, timeoutMs, perspective: input.perspective });

      let reply = await ask(job, author());
      let usage = reply.usage;
      let result = read(reply);
      if (!result.ok) {
        log({ step: "describe-game", call: "script", outcome: "rejected", retry: true });
        reply = await ask(job, author(result.reason));
        usage = { inputTokens: usage.inputTokens + reply.usage.inputTokens, outputTokens: usage.outputTokens + reply.usage.outputTokens };
        result = read(reply);
        if (!result.ok) {
          log({ step: "describe-game", call: "script", outcome: "bad-answer", ...usage });
          throw problem(BAD_ANSWER);
        }
      }

      await deps.cache.put(key, { value: result.stored, model: deps.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      log({ step: "describe-game", call: "script", outcome: "asked", ...usage });
      return { ...result.stored, asked: true };
    },
  };
}
