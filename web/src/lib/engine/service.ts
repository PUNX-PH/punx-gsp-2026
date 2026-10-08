// The game service: from words (and a picture) to a checked, playtested GameSpec and the assets it needs. Claude writes the game through the
// GameAuthor port; the answer is repaired, checked and played by bots before anyone sees it, with one retry that tells Claude why the first was
// rejected. Cached per person, counted against the daily AI limits, shaped to Play's clock. It knows nothing about Firestore or Claude's vendor:
// those are the ports it is given, so every rule here is tested with fakes.
import { cleanPrompt } from "@/lib/ai/answer";
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES } from "@/lib/ai/anthropic";
import { dayOf } from "@/lib/ai/key";
import type { UsageLimits } from "@/lib/ai/ports";
import { AiRefusedError, AiUnavailableError, type DesignReply } from "@/lib/ai/types";
import { MODEL_KINDS, type ModelKind } from "@/lib/builder/kinds";
import type { RecipeCache } from "@/lib/builder/ports";
import { MIN_START_MS, RAN_OUT_OF_TIME, timeLeft } from "@/lib/graph/playTime";
import { MAX_PROMPT_CHARACTERS } from "@/lib/graph/registry";
import { NodeError } from "@/lib/graph/types";
import type { GameAuthor } from "./author";
import { checkSpec } from "./check";
import { gameKey } from "./keys";
import { playtest } from "./playtest";
import { ASSET_ROLES } from "./prompts";
import { repairSpec } from "./repair";
import { ENGINE_CAPS, PRIMITIVES, type GameSpec } from "./spec";

export type AssetRole = (typeof ASSET_ROLES)[number];
export interface AssetRequest {
  entity: string;
  role: AssetRole;
  kind: ModelKind;
  description: string;
}

/** What is stored and returned: the repaired spec, what Claude said it left out, the assets to make and what repair changed. */
export interface StoredGame {
  spec: GameSpec;
  leftOut: string;
  assets: AssetRequest[];
  notes: string[];
}

/**
 * What the cache holds. The spec is kept as text: a store such as Firestore may hand a map's keys back sorted, and the order of the entities decides
 * which events and collisions come first in the engine, so a cached game must be exactly the one that was playtested.
 */
export interface CachedGame {
  spec: string;
  leftOut: string;
  assets: AssetRequest[];
  notes: string[];
}

export interface GameDeps {
  author: GameAuthor;
  cache: RecipeCache<CachedGame>;
  limits: UsageLimits;
  /** Claude's model name: part of every cache key and stored with every answer. */
  modelId: string;
  perPerson: number;
  total: number;
  now: () => number;
  /** Where outcomes are logged: the step, the outcome, counts and statuses, never the person's words or a spec. */
  log?: (info: object) => void;
}

export interface GameJob {
  user: { uid: string };
  /** The moment Play must be finished by (graph/playTime.ts). */
  deadline: number;
}

export interface GameInput {
  description: string;
  picture: { sha256: string; bytes: Uint8Array } | null;
  /** Names of the models wired into the step. */
  models: string[];
}

export interface GameService {
  /** `asked` is true when Claude was asked, false when the game came from the cache. */
  create(job: GameJob, input: GameInput): Promise<StoredGame & { asked: boolean }>;
}

const LABEL = "Describe Game";
const NO_ANSWER = "The AI service did not answer. Try again.";
const BAD_ANSWER = "The AI could not build this game. Try different words.";
const NOT_PLAYABLE = "The AI could not make a playable game from this. Try different words.";
const MAX_LEFT_OUT = 200;
const MAX_ASSET_DESCRIPTION = 300;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The assets Claude asked for, kept only when they name a real, non-spawner entity with a valid role and kind; one per entity, at most the cap. */
function checkedAssets(raw: unknown, spec: GameSpec): AssetRequest[] {
  if (!Array.isArray(raw)) return [];
  const out: AssetRequest[] = [];
  for (const item of raw) {
    if (!isObject(item) || typeof item.entity !== "string" || typeof item.description !== "string") continue;
    const entity = spec.entities[item.entity];
    if (!Object.hasOwn(spec.entities, item.entity) || entity.behaviors.some((b) => b.type === "spawn")) continue;
    if (!(ASSET_ROLES as readonly string[]).includes(item.role as string) || !(MODEL_KINDS as readonly string[]).includes(item.kind as string)) continue;
    if (out.some((a) => a.entity === item.entity)) continue;
    out.push({ entity: item.entity, role: item.role as AssetRole, kind: item.kind as ModelKind, description: cleanPrompt(item.description).slice(0, MAX_ASSET_DESCRIPTION) });
    if (out.length === ENGINE_CAPS.generatedAssets) break;
  }
  return out;
}

/** Entities with an asset get a model name that is not a primitive; any other entity with a name that is neither wired in nor a primitive is a box. */
function bindModels(spec: GameSpec, assets: AssetRequest[], wired: string[]): GameSpec {
  const forAsset = new Set(assets.map((a) => a.entity));
  const entities = Object.fromEntries(
    Object.entries(spec.entities).map(([name, e]) => {
      const primitive = (PRIMITIVES as readonly string[]).includes(e.model);
      if (forAsset.has(name)) return [name, { ...e, model: `${name}Art` }];
      return [name, primitive || wired.includes(e.model) ? e : { ...e, model: "box" }];
    }),
  );
  return { ...spec, entities };
}

/** A stored game back as a checked one, or null when what the cache holds is not one (it is then asked again). */
function readCached(value: CachedGame): StoredGame | null {
  try {
    const checked = checkSpec(JSON.parse(value.spec));
    return checked.ok ? { spec: checked.spec, leftOut: value.leftOut, assets: value.assets, notes: value.notes } : null;
  } catch {
    return null;
  }
}

type Read = { ok: false; reason: string } | { ok: true; game: StoredGame; verdict: ReturnType<typeof playtest> };

export function makeGameService(deps: GameDeps): GameService {
  const log = deps.log ?? (() => {});
  const problem = (message: string) => new NodeError(`${LABEL}: ${message}`);

  /** One call to Claude and what must happen around it: Play's clock, one AI count before the call, the count given back when no answer came. */
  async function ask(job: GameJob, request: (timeoutMs: number) => Promise<DesignReply>): Promise<DesignReply> {
    const left = timeLeft(job.deadline, deps.now());
    if (left < MIN_START_MS) {
      log({ step: "describe-game", call: "game", outcome: "no-time" });
      throw problem(RAN_OUT_OF_TIME);
    }
    const timeoutMs = Math.min(DEFAULT_TIMEOUT_MS, Math.floor(left / (MAX_RETRIES + 1)));
    const day = dayOf(deps.now());
    const taken = await deps.limits.take(job.user.uid, day, { perPerson: deps.perPerson, total: deps.total });
    if (taken !== "ok") {
      log({ step: "describe-game", call: "game", outcome: taken });
      throw problem(taken === "person-limit" ? "You have used today's AI answers. Try again tomorrow." : "The AI is busy today. Try again tomorrow.");
    }
    try {
      return await request(timeoutMs);
    } catch (error) {
      if (error instanceof AiRefusedError) {
        log({ step: "describe-game", call: "game", outcome: "refused" });
        throw problem("The AI declined this request. Try different words.");
      }
      await deps.limits.give(job.user.uid, day);
      if (error instanceof AiUnavailableError) log({ step: "describe-game", call: "game", outcome: "unavailable", ...(error.status === undefined ? {} : { status: error.status }), ...(error.detail === undefined ? {} : { detail: error.detail }) });
      else log({ step: "describe-game", call: "game", outcome: "unexpected", kind: error instanceof Error ? error.name : typeof error });
      throw problem(NO_ANSWER);
    }
  }

  /**
   * The reply as a checked game and its playtest verdict, or the reason it could not be used (a sentence Claude can act on in its one retry). The game
   * arrives as JSON text in `game` (an object is accepted too); repair, the engine's checks and the playtest are what make it a game.
   */
  function read(reply: DesignReply, wired: string[]): Read {
    if (!isObject(reply.raw) || reply.raw.game === undefined) return { ok: false, reason: 'Your answer had no "game" holding the game as JSON text.' };
    let game: unknown = reply.raw.game;
    if (typeof game === "string") {
      try {
        game = JSON.parse(game);
      } catch {
        return { ok: false, reason: 'The text in "game" was not valid JSON. Write one JSON object, with no comments or trailing commas.' };
      }
    }
    const repaired = repairSpec(game);
    if (!repaired) return { ok: false, reason: "The game could not be used: it needs exactly one hero entity and the parts described, each with its own parameters." };
    const assets = checkedAssets(reply.raw.assets, repaired.spec);
    const bound = bindModels(repaired.spec, assets, wired);
    const checked = checkSpec(bound);
    if (!checked.ok) return { ok: false, reason: `The game did not pass the engine's checks: ${checked.error}` };
    const leftOut = typeof reply.raw.leftOut === "string" ? cleanPrompt(reply.raw.leftOut).slice(0, MAX_LEFT_OUT) : "";
    return { ok: true, game: { spec: checked.spec, leftOut, assets, notes: repaired.notes }, verdict: playtest(checked.spec) };
  }

  return {
    async create(job, input) {
      // The step already limits the words; a caller that does not gets the same limit here, before anything is keyed or sent.
      const description = Array.from(cleanPrompt(input.description)).slice(0, MAX_PROMPT_CHARACTERS).join("");
      if (description === "") throw problem("describe the game you want.");

      const key = await gameKey({ model: deps.modelId, uid: job.user.uid, description, pictureSha: input.picture?.sha256 ?? null, models: input.models });
      const found = await deps.cache.get(key);
      const cached = found ? readCached(found.value) : null;
      if (cached) {
        log({ step: "describe-game", call: "game", outcome: "reused" });
        return { ...cached, asked: false };
      }

      const author = (retryReason?: string) => (timeoutMs: number) =>
        deps.author.author({ description, picture: input.picture?.bytes ?? null, models: input.models, retryReason, timeoutMs });

      let reply = await ask(job, author());
      let usage = reply.usage;
      let result = read(reply, input.models);
      if (!result.ok || !result.verdict.ok) {
        const reason = result.ok ? (result.verdict.ok ? "" : result.verdict.reason) : result.reason;
        log({ step: "describe-game", call: "game", outcome: result.ok ? "playtest-failed" : "unreadable", retry: true });
        reply = await ask(job, author(reason));
        usage = { inputTokens: usage.inputTokens + reply.usage.inputTokens, outputTokens: usage.outputTokens + reply.usage.outputTokens };
        result = read(reply, input.models);
        if (!result.ok) {
          log({ step: "describe-game", call: "game", outcome: "bad-answer", ...usage });
          throw problem(BAD_ANSWER);
        }
        if (!result.verdict.ok) {
          log({ step: "describe-game", call: "game", outcome: "not-playable", ...usage });
          throw problem(NOT_PLAYABLE);
        }
      }

      await deps.cache.put(key, { value: { ...result.game, spec: JSON.stringify(result.game.spec) }, model: deps.modelId, createdAt: deps.now(), inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      log({ step: "describe-game", call: "game", outcome: "asked", ...usage });
      return { ...result.game, asked: true };
    },
  };
}
