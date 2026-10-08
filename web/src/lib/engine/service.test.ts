import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import type { DesignReply } from "@/lib/ai/types";
import { AiRefusedError, AiUnavailableError } from "@/lib/ai/types";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import { NodeError } from "@/lib/graph/types";
import type { GameAuthor } from "./author";
import { checkSpec } from "./check";
import { gameKey } from "./keys";
import { makeGameService, type StoredGame } from "./service";

// The tests edit a parsed fixture freely, so it is deliberately untyped.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(__dirname, "fixtures", "specs", `${name}.json`), "utf8"));

/** A game as Claude writes it: counters and entities as named lists, every rule with a `when` list. */
const asClaudeWrites = (spec: Json): Json => ({
  ...spec,
  counters: Object.entries(spec.counters).map(([name, value]) => ({ name, value })),
  entities: Object.entries(spec.entities).map(([name, e]) => ({ name, ...(e as object) })),
  rules: spec.rules.map((r: object) => ({ when: [], ...r })),
});

const answer = (game: Json, extra: Json = {}): DesignReply => ({
  raw: { game: asClaudeWrites(game), leftOut: "", assets: [], ...extra },
  usage: { inputTokens: 100, outputTokens: 200 },
});

type Step = DesignReply | Error;
class ScriptedAuthor implements GameAuthor {
  calls: Parameters<GameAuthor["author"]>[0][] = [];
  constructor(private steps: Step[]) {}
  async author(request: Parameters<GameAuthor["author"]>[0]): Promise<DesignReply> {
    this.calls.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error("no more scripted answers");
    if (step instanceof Error) throw step;
    return step;
  }
}

const NOW = Date.parse("2026-10-08T12:00:00Z");
const job = { user: { uid: "u1" }, deadline: NOW + 120_000 };
const input = { description: "a fox that jumps over logs", picture: null, models: [] as string[] };

function make(steps: Step[], over: { perPerson?: number; total?: number; reverseKeys?: boolean } = {}) {
  const author = new ScriptedAuthor(steps);
  const cache = new MemoryRecipeCache<StoredGame>({ reverseKeys: over.reverseKeys });
  const limits = new MemoryUsageLimits();
  const logs: object[] = [];
  const service = makeGameService({ author, cache, limits, modelId: "claude-test", perPerson: over.perPerson ?? 30, total: over.total ?? 300, now: () => NOW, log: (i) => logs.push(i) });
  return { author, cache, limits, service, logs };
}
const used = (limits: MemoryUsageLimits) => [...limits.counts.values()].reduce((a, b) => Math.max(a, b), 0);
const message = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(NodeError);
    return (e as Error).message;
  }
  throw new Error("expected a failure");
};
const endless = (): Json => {
  const spec = fixture("runner");
  spec.counters = { score: 0 };
  spec.rules = [spec.rules[1]];
  spec.ends = { timeLimitMs: 0, winOnTime: true, scoreToWin: 0 };
  return spec;
};

describe("the game service", () => {
  it("repairs, checks and playtests Claude's answer, stores it, and counts one AI answer", async () => {
    const { service, cache, limits, author } = make([answer(fixture("runner"), { leftOut: "no 3D worlds" })]);
    const r = await service.create(job, input);
    expect(r.asked).toBe(true);
    expect(checkSpec(r.spec).ok).toBe(true);
    expect(r.leftOut).toBe("no 3D worlds");
    expect(author.calls).toHaveLength(1);
    expect(cache.entries.size).toBe(1);
    expect(used(limits)).toBe(1);
  });

  it("reuses a stored game for the same words, with no call and no count (even when the store reorders keys)", async () => {
    const { service, author, limits } = make([answer(fixture("runner"))], { reverseKeys: true });
    await service.create(job, input);
    const again = await service.create(job, input);
    expect(again.asked).toBe(false);
    expect(author.calls).toHaveLength(1);
    expect(used(limits)).toBe(1);
  });

  it("keeps assets that name a real entity, drops the rest, caps them, and gives their entities a model name", async () => {
    const assets = [
      { entity: "hero", role: "hero", kind: "biped", description: "a red fox" },
      { entity: "ghost", role: "hero", kind: "biped", description: "nobody" },
      { entity: "spikes", role: "obstacle", kind: "prop", description: "a spawner is not drawn" },
      { entity: "spike", role: "wizard", kind: "prop", description: "bad role" },
      { entity: "coin", role: "collectible", kind: "prop", description: "x".repeat(500) },
      { entity: "hero", role: "hero", kind: "biped", description: "a duplicate" },
    ];
    const { service } = make([answer(fixture("runner"), { assets })]);
    const r = await service.create(job, input);
    expect(r.assets.map((a) => a.entity)).toEqual(["hero", "coin"]);
    expect(r.assets[1].description).toHaveLength(300);
    expect(r.spec.entities.hero.model).toBe("heroArt");
    expect(r.spec.entities.coin.model).toBe("coinArt");
    expect(r.spec.entities.spike.model).toBe("box"); // "cone" is not a primitive, not wired in, and has no asset
  });

  it("keeps a model name that is wired into the step", async () => {
    const game = fixture("runner");
    game.entities.hero.model = "foxModel";
    const { service } = make([answer(game)]);
    const r = await service.create(job, { ...input, models: ["foxModel"] });
    expect(r.spec.entities.hero.model).toBe("foxModel");
  });

  it("retries once with the playtest's reason, and counts both calls", async () => {
    const { service, author, limits } = make([answer(endless()), answer(fixture("runner"))]);
    const r = await service.create(job, input);
    expect(r.asked).toBe(true);
    expect(author.calls).toHaveLength(2);
    expect(author.calls[0].retryReason).toBeUndefined();
    expect(author.calls[1].retryReason).toMatch(/no way to end/);
    expect(used(limits)).toBe(2);
  });

  it("gives the plain message when the retry is rejected too, and keeps the counts", async () => {
    const { service, limits, cache } = make([answer(endless()), answer(endless())]);
    expect(await message(service.create(job, input))).toBe("Describe Game: The AI could not make a playable game from this. Try different words.");
    expect(used(limits)).toBe(2);
    expect(cache.entries.size).toBe(0);
  });

  it("keeps the count when the answer is beyond repair, and says so plainly", async () => {
    const { service, limits } = make([{ raw: "not a game", usage: { inputTokens: 1, outputTokens: 1 } }]);
    expect(await message(service.create(job, input))).toBe("Describe Game: The AI could not build this game. Try different words.");
    expect(used(limits)).toBe(1);
  });

  it("keeps the count on a refusal, and gives it back when the service did not answer or something unexpected happened", async () => {
    const refused = make([new AiRefusedError()]);
    expect(await message(refused.service.create(job, input))).toBe("Describe Game: The AI declined this request. Try different words.");
    expect(used(refused.limits)).toBe(1);

    const down = make([new AiUnavailableError(529)]);
    expect(await message(down.service.create(job, input))).toBe("Describe Game: The AI service did not answer. Try again.");
    expect(used(down.limits)).toBe(0);
    expect(JSON.stringify(down.logs)).toContain("529");

    const odd = make([new TypeError("boom")]);
    expect(await message(odd.service.create(job, input))).toBe("Describe Game: The AI service did not answer. Try again.");
    expect(used(odd.limits)).toBe(0);
  });

  it("refuses when the person's or the site's daily answers are used up, without calling Claude", async () => {
    const person = make([], { perPerson: 0 });
    expect(await message(person.service.create(job, input))).toBe("Describe Game: You have used today's AI answers. Try again tomorrow.");
    const site = make([], { total: 0 });
    expect(await message(site.service.create(job, input))).toBe("Describe Game: The AI is busy today. Try again tomorrow.");
    expect(person.author.calls).toHaveLength(0);
  });

  it("starts no call that Play's clock could not finish, and counts nothing", async () => {
    const { service, author, limits } = make([answer(fixture("runner"))]);
    expect(await message(service.create({ ...job, deadline: NOW + 5_000 }, input))).toMatch(/^Describe Game: Play ran out of time/);
    expect(author.calls).toHaveLength(0);
    expect(used(limits)).toBe(0);
  });

  it("needs words, and cleans them before they are used or keyed", async () => {
    const { service, author } = make([answer(fixture("runner"))]);
    expect(await message(service.create(job, { ...input, description: "  \u0000 " }))).toBe("Describe Game: describe the game you want.");
    await service.create(job, { ...input, description: "  a fox\u0007 that jumps  " });
    expect(author.calls[0].description).toBe("a fox that jumps");
  });

  it("keys on the person, the picture and the wired models, not on their order", async () => {
    const base = { model: "m", uid: "u", description: "d", pictureSha: null, models: ["b", "a"] };
    expect(await gameKey(base)).toBe(await gameKey({ ...base, models: ["a", "b"] }));
    expect(await gameKey(base)).not.toBe(await gameKey({ ...base, uid: "v" }));
    expect(await gameKey(base)).not.toBe(await gameKey({ ...base, pictureSha: "abc" }));
  });
});
