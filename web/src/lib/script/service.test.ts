import { describe, expect, it } from "vitest";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import type { DesignReply } from "@/lib/ai/types";
import { AiRefusedError, AiUnavailableError } from "@/lib/ai/types";
import { MemoryRecipeCache } from "@/lib/builder/memory";
import { NodeError } from "@/lib/graph/types";
import { SCRIPT_LIMITS } from "./api";
import type { ScriptAuthor } from "./author";
import { EXAMPLE_GAMES } from "./examples";
import { scriptKey } from "./keys";
import { type CachedScript, makeScriptService } from "./service";

const GOOD = EXAMPLE_GAMES.flier;
const OTHER = EXAMPLE_GAMES.catcher;

const answer = (script: string, extra: Record<string, unknown> = {}): DesignReply => ({
  raw: { script, leftOut: "", assets: [], ...extra },
  usage: { inputTokens: 100, outputTokens: 200 },
});

type Step = DesignReply | Error;
class ScriptedAuthor implements ScriptAuthor {
  calls: Parameters<ScriptAuthor["author"]>[0][] = [];
  constructor(private steps: Step[]) {}
  async author(request: Parameters<ScriptAuthor["author"]>[0]): Promise<DesignReply> {
    this.calls.push(request);
    const step = this.steps.shift();
    if (!step) throw new Error("no more scripted answers");
    if (step instanceof Error) throw step;
    return step;
  }
}

const NOW = Date.parse("2026-10-09T12:00:00Z");
const job = { user: { uid: "u1" }, deadline: NOW + 120_000 };
const input = { description: "a bird that flies through pipes", picture: null, models: [] as string[], attempt: 0 };

function make(steps: Step[], over: { perPerson?: number; total?: number; reverseKeys?: boolean } = {}) {
  const author = new ScriptedAuthor(steps);
  const cache = new MemoryRecipeCache<CachedScript>({ reverseKeys: over.reverseKeys });
  const limits = new MemoryUsageLimits();
  const logs: object[] = [];
  const service = makeScriptService({ author, cache, limits, modelId: "claude-test", perPerson: over.perPerson ?? 30, total: over.total ?? 300, now: () => NOW, log: (i) => logs.push(i) });
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

describe("the script service", () => {
  it("checks Claude's script, stores it, and counts one AI answer", async () => {
    const { service, cache, limits, author } = make([answer(GOOD, { leftOut: "no sound" })]);
    const r = await service.create(job, input);
    expect(r.asked).toBe(true);
    expect(r.script).toBe(GOOD);
    expect(r.leftOut).toBe("no sound");
    expect(author.calls).toHaveLength(1);
    expect(cache.entries.size).toBe(1);
    expect(used(limits)).toBe(1);
  });

  it("reuses a stored script for the same words, with no call and no count (even when the store reorders keys)", async () => {
    const { service, author, limits } = make([answer(GOOD)], { reverseKeys: true });
    await service.create(job, input);
    const again = await service.create(job, input);
    expect(again.asked).toBe(false);
    expect(again.script).toBe(GOOD);
    expect(author.calls).toHaveLength(1);
    expect(used(limits)).toBe(1);
  });

  it("asks again when what the cache holds is not a script that passes the check", async () => {
    const { service, cache, author } = make([answer(GOOD), answer(GOOD)]);
    await service.create(job, input);
    for (const [key, entry] of cache.entries) cache.entries.set(key, { ...entry, value: { ...entry.value, script: "os.exit()" } });
    const again = await service.create(job, input);
    expect(again.asked).toBe(true);
    expect(author.calls).toHaveLength(2);
  });

  it("Try again (a higher attempt number) asks Claude once more, and every Play with that number reuses the new answer", async () => {
    const { service, cache, author, limits } = make([answer(GOOD), answer(OTHER)]);
    await service.create(job, input);
    const fresh = await service.create(job, { ...input, attempt: 1 });
    expect(fresh.asked).toBe(true);
    expect(fresh.script).toBe(OTHER);
    expect(author.calls).toHaveLength(2);
    expect(cache.entries.size).toBe(2);
    expect(used(limits)).toBe(2);
    const again = await service.create(job, { ...input, attempt: 1 });
    expect(again.asked).toBe(false);
    expect(again.script).toBe(OTHER);
    expect(author.calls).toHaveLength(2);
    const first = await service.create(job, input);
    expect(first.asked).toBe(false);
    expect(first.script).toBe(GOOD);
  });

  it("gives five colors: Claude's own, with any missing or wrong one replaced by the sample palette's", async () => {
    const full = await make([answer(GOOD, { palette: ["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"] })]).service.create(job, input);
    expect(full.palette).toEqual(["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"]);
    const partial = await make([answer(GOOD, { palette: ["#112233", "red", 5] })]).service.create(job, input);
    expect(partial.palette).toHaveLength(5);
    expect(partial.palette[0]).toBe("#112233");
    for (const color of partial.palette) expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
    for (const raw of [undefined, "blue", { a: 1 }]) {
      const none = await make([answer(GOOD, { palette: raw })]).service.create(job, input);
      expect(none.palette).toHaveLength(5);
    }
  });

  it("keeps the palette through the cache", async () => {
    const { service } = make([answer(GOOD, { palette: ["#112233", "#445566", "#778899", "#aabbcc", "#ddeeff"] })]);
    await service.create(job, input);
    const again = await service.create(job, input);
    expect(again.asked).toBe(false);
    expect(again.palette[4]).toBe("#ddeeff");
  });

  it("retries once with the reason when the script fails the check, and counts both calls", async () => {
    const { service, author, limits } = make([answer("function update(dt)\n  os.exit()\nend"), answer(GOOD)]);
    const r = await service.create(job, input);
    expect(r.asked).toBe(true);
    expect(r.script).toBe(GOOD);
    expect(author.calls).toHaveLength(2);
    expect(author.calls[0].retryReason).toBeUndefined();
    expect(author.calls[1].retryReason).toContain("`os`");
    expect(author.calls[1].retryReason).toContain("line 2");
    expect(used(limits)).toBe(2);
  });

  it("gives the plain message when the retry fails the check too, keeps the counts and stores nothing", async () => {
    const bad = answer("function update(dt) io.write('x') end");
    const { service, limits, cache } = make([bad, bad]);
    expect(await message(service.create(job, input))).toBe("Describe Game: The AI could not build this game. Try different words.");
    expect(used(limits)).toBe(2);
    expect(cache.entries.size).toBe(0);
  });

  it("tells Claude when the answer had no script, or it was not text, and takes the corrected one", async () => {
    const none = { raw: { leftOut: "", assets: [] }, usage: { inputTokens: 1, outputTokens: 1 } };
    const first = make([none, answer(GOOD)]);
    expect((await first.service.create(job, input)).script).toBe(GOOD);
    expect(first.author.calls[1].retryReason).toMatch(/no "script"/);

    const notText = { raw: { script: { code: GOOD }, leftOut: "", assets: [] }, usage: { inputTokens: 1, outputTokens: 1 } };
    const second = make([notText, answer(GOOD)]);
    await second.service.create(job, input);
    expect(second.author.calls[1].retryReason).toMatch(/no "script"/);

    const odd = { raw: "not an object", usage: { inputTokens: 1, outputTokens: 1 } };
    const third = make([odd, odd]);
    expect(await message(third.service.create(job, input))).toBe("Describe Game: The AI could not build this game. Try different words.");
    expect(used(third.limits)).toBe(2);
  });

  it("refuses a script over the size limit, and one with a syntax error, with the reason for the retry", async () => {
    const big = answer("-- " + "x".repeat(SCRIPT_LIMITS.scriptBytes) + "\nfunction update(dt) end");
    const a = make([big, answer(GOOD)]);
    await a.service.create(job, input);
    expect(a.author.calls[1].retryReason).toMatch(/bytes/);
    const b = make([answer("function update(dt)\n  local x =\nend"), answer(GOOD)]);
    await b.service.create(job, input);
    expect(b.author.calls[1].retryReason).toMatch(/line 3/);
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
    const { service, author, limits } = make([answer(GOOD)]);
    expect(await message(service.create({ ...job, deadline: NOW + 5_000 }, input))).toMatch(/^Describe Game: Play ran out of time/);
    expect(author.calls).toHaveLength(0);
    expect(used(limits)).toBe(0);
  });

  it("needs words, cleans them before they are used or keyed, and sends at most 500 characters", async () => {
    const { service, author } = make([answer(GOOD), answer(GOOD)]);
    expect(await message(service.create(job, { ...input, description: "  \u0000 " }))).toBe("Describe Game: describe the game you want.");
    await service.create(job, { ...input, description: "  a bird\u0007 that flies  " });
    expect(author.calls[0].description).toBe("a bird that flies");
    await service.create(job, { ...input, description: "x".repeat(10_000) });
    expect(author.calls[1].description).toHaveLength(500);
  });

  it("keeps the left-out sentence short and clean", async () => {
    const { service } = make([answer(GOOD, { leftOut: "<b>no sound</b>\u0000 " + "y".repeat(500) })]);
    const r = await service.create(job, input);
    expect(r.leftOut.length).toBeLessThanOrEqual(200);
    expect(r.leftOut).not.toContain("\u0000");
  });

  it("never logs the person's words or the script", async () => {
    const { service, logs } = make([answer(GOOD)]);
    await service.create(job, { ...input, description: "SECRET WORDS" });
    const text = JSON.stringify(logs);
    expect(text).not.toContain("SECRET");
    expect(text).not.toContain("function init");
    expect(text).toContain("asked");
  });

  describe("the art style and the world Claude plans", () => {
    const one = async (extra: Record<string, unknown>) => (await make([answer(GOOD, extra)]).service.create(job, input));

    it("keeps a style from the list, and falls back to stylized for anything else", async () => {
      expect((await one({ style: "cartoon" })).style).toBe("cartoon");
      expect((await one({ style: "photoreal" })).style).toBe("stylized");
      expect((await one({})).style).toBe("stylized");
    });

    it("reads the world: palette slots 1 to 5 become indexes 0 to 4, scenery is cleaned and capped at three, empty pieces dropped", async () => {
      const r = await one({
        world: { sky: 5, ground: 2, scenery: [{ description: "a snowy pine" }, { description: "   " }, { description: "a neon sign" }, { description: "a" }, { description: "b" }, { description: "c" }] },
      });
      expect(r.world).toEqual({ sky: 4, ground: 1, scenery: [{ description: "a snowy pine" }, { description: "a neon sign" }, { description: "a" }] });
    });

    it("clamps wild slots, and has no world when Claude planned none", async () => {
      expect((await one({ world: { sky: 99, ground: -4, scenery: [] } })).world).toEqual({ sky: 4, ground: 0, scenery: [] });
      expect((await one({ world: { scenery: [] } })).world).toBeNull();
      expect((await one({ world: "a forest" })).world).toBeNull();
      expect((await one({})).world).toBeNull();
    });
  });

  describe("the models Claude asks for", () => {
    const base = { entity: "hero", role: "hero", kind: "biped", description: "a red fox" };
    const script = (names: string[]) => `${GOOD}\nfunction extra() ${names.map((n) => `world.spawn("${n}")`).join(" ")} end\n`;

    it("keeps the ones the script spawns by name, and cleans and caps what it says about them", async () => {
      const r = await make([answer(script(["hero"]), { assets: [{ ...base, description: "x".repeat(500) }] })]).service.create(job, input);
      expect(r.assets).toHaveLength(1);
      expect(r.assets[0]).toMatchObject({ entity: "hero", role: "hero" }); // no kit kind is asked for any more: every model is freeform
      expect(r.assets[0].description.length).toBeLessThanOrEqual(300);
    });

    it("drops a model the script never spawns, a primitive's name, a bad name, a bad role, a repeat (a kind is not asked for or checked)", async () => {
      const assets = [
        { ...base, entity: "ghost" }, // not in the script
        { ...base, entity: "box" }, // a primitive
        { ...base, entity: "Hero" }, // not allowed: a capital first
        { ...base, entity: "has space" },
        { ...base, entity: "coin", role: "wizard" },
        { ...base, entity: "tree" },
        { ...base, entity: "tree", description: "again" },
        { entity: "rock", role: "obstacle", kind: "prop" }, // no description
      ];
      const names = ["box", "Hero", "has space", "coin", "tree", "rock"]; // ghost is left out of the script on purpose
      const r = await make([answer(script(names), { assets })]).service.create(job, input);
      expect(r.assets.map((a) => a.entity)).toEqual(["tree"]);
      expect(r.assets[0].description).toBe("a red fox");
    });

    it("keeps at most the cap", async () => {
      const names = ["a", "b", "c", "d", "e", "f", "g", "h"];
      const assets = names.map((entity) => ({ ...base, entity }));
      const r = await make([answer(script(names), { assets })]).service.create(job, input);
      expect(r.assets).toHaveLength(SCRIPT_LIMITS.assets);
    });

    it("accepts a model name written with single quotes, and ignores assets that are not a list", async () => {
      const text = `${GOOD}\nfunction extra() world.spawn('hero') end\n`;
      expect((await make([answer(text, { assets: [base] })]).service.create(job, input)).assets).toHaveLength(1);
      expect((await make([answer(GOOD, { assets: "hero" })]).service.create(job, input)).assets).toEqual([]);
    });

    it("lets the script spawn a model that is wired into the step without asking for it", async () => {
      const r = await make([answer(script(["fox"]))]).service.create(job, { ...input, models: ["fox"] });
      expect(r.assets).toEqual([]);
    });
  });

  it("keys on the person, the picture and the wired models, not on their order", async () => {
    const base = { model: "m", uid: "u", description: "d", pictureSha: null, models: ["b", "a"], attempt: 0 };
    expect(await scriptKey(base)).toBe(await scriptKey({ ...base, models: ["a", "b"] }));
    expect(await scriptKey(base)).not.toBe(await scriptKey({ ...base, uid: "v" }));
    expect(await scriptKey(base)).not.toBe(await scriptKey({ ...base, pictureSha: "abc" }));
    expect(await scriptKey(base)).not.toBe(await scriptKey({ ...base, description: "e" }));
    expect(await scriptKey(base)).not.toBe(await scriptKey({ ...base, attempt: 1 }));
  });
});
