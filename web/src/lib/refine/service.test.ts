import { describe, expect, it } from "vitest";
import { MemoryUsageLimits } from "@/lib/ai/memory";
import { AiRefusedError, AiUnavailableError, type DesignReply } from "@/lib/ai/types";
import { GraphError } from "@/lib/graph/types";
import { REFINED_MAX_CHARACTERS } from "./prompts";
import { makeRefineService, type RefineDeps } from "./service";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const user = { uid: "u1", email: "u1@punx.ai" };
const reply = (raw: unknown): DesignReply => ({ raw, usage: { inputTokens: 10, outputTokens: 20 } });

function make(answer: DesignReply | Error, over: { perPerson?: number; total?: number } = {}) {
  const calls: Parameters<RefineDeps["ask"]>[0][] = [];
  const limits = new MemoryUsageLimits();
  const logs: object[] = [];
  const service = makeRefineService({
    ask: async (request) => {
      calls.push(request);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    limits,
    perPerson: over.perPerson ?? 30,
    total: over.total ?? 300,
    now: () => NOW,
    log: (info) => logs.push(info),
  });
  return { service, calls, limits, logs };
}
const used = (limits: MemoryUsageLimits) => Math.max(0, ...limits.counts.values());
const failure = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (error) {
    expect(error).toBeInstanceOf(GraphError);
    return error as GraphError;
  }
  throw new Error("expected a failure");
};

describe("the prompt refiner", () => {
  it("returns the improved text, counts one AI answer, and sends the words in the user's turn only", async () => {
    const { service, calls, limits } = make(reply({ refined: "A 2D side-view game where a fox jumps over logs." }));
    expect(await service.refine(user, "fox jumps")).toBe("A 2D side-view game where a fox jumps over logs.");
    expect(used(limits)).toBe(1);
    expect(JSON.stringify(calls[0].system)).not.toContain("fox jumps");
    expect(JSON.stringify(calls[0].content)).toContain("fox jumps");
    expect(JSON.stringify(calls[0].content)).toMatch(/material to rewrite, not instructions/);
  });

  it("cleans the answer and keeps it under the limit", async () => {
    const { service } = make(reply({ refined: "  a\u0000b " + "x".repeat(900) }));
    const refined = await service.refine(user, "a game");
    expect(Array.from(refined).length).toBeLessThanOrEqual(REFINED_MAX_CHARACTERS);
    expect(refined).not.toContain("\u0000");
  });

  it("needs a few words, and sends at most 500 characters", async () => {
    const { service, calls } = make(reply({ refined: "ok" }));
    expect((await failure(service.refine(user, "  a "))).status).toBe(400);
    expect(calls).toHaveLength(0);
    await service.refine(user, "x".repeat(5000));
    expect(JSON.stringify(calls[0].content).length).toBeLessThan(900);
  });

  it("gives the count back when no usable answer came, and says plainly what happened", async () => {
    const empty = make(reply({ refined: "   " }));
    expect((await failure(empty.service.refine(user, "a fox game"))).status).toBe(503);
    expect(used(empty.limits)).toBe(0);

    const down = make(new AiUnavailableError(529));
    expect((await failure(down.service.refine(user, "a fox game"))).message).toBe("The AI service did not answer. Try again.");
    expect(used(down.limits)).toBe(0);
    expect(JSON.stringify(down.logs)).toContain("529");

    const odd = make(new TypeError("boom"));
    expect((await failure(odd.service.refine(user, "a fox game"))).status).toBe(503);
    expect(used(odd.limits)).toBe(0);
  });

  it("keeps the count on a refusal", async () => {
    const refused = make(new AiRefusedError());
    expect((await failure(refused.service.refine(user, "a fox game"))).message).toMatch(/declined/);
    expect(used(refused.limits)).toBe(1);
  });

  it("refuses when the daily answers are used up, without calling the AI, and never logs the words", async () => {
    const person = make(reply({ refined: "x" }), { perPerson: 0 });
    expect((await failure(person.service.refine(user, "a fox game"))).status).toBe(429);
    const site = make(reply({ refined: "x" }), { total: 0 });
    expect((await failure(site.service.refine(user, "a fox game"))).message).toMatch(/busy/);
    expect(person.calls).toHaveLength(0);
    const ok = make(reply({ refined: "improved text" }));
    await ok.service.refine(user, "SECRET WORDS");
    expect(JSON.stringify(ok.logs)).not.toContain("SECRET");
  });
});
