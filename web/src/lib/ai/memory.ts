// In-memory versions of the AI ports, for tests. They behave like the real ones where it matters: `take` is atomic (the check
// and the count happen with nothing in between), every call yields to other callers first so that concurrent requests
// interleave, and a cached answer is a copy.
import { personDocId, siteDocId } from "@/lib/ai/key";
import type { AnswerCache, CachedAnswer, TakeResult, UsageLimits } from "@/lib/ai/ports";
import { AiUnavailableError, type DesignReply, type Designer } from "@/lib/ai/types";

const yieldToOthers = () => Promise.resolve();

type DesignMethod = "designModel" | "designMotion" | "designEnvironment";

/**
 * A designer that answers from a script and remembers every request it was sent, in order. A method with no script is "not
 * available", as the real one is when the key is missing.
 */
export class ScriptedDesigner implements Designer {
  readonly calls: { method: DesignMethod; request: unknown }[] = [];

  constructor(private readonly script: Partial<{ [M in DesignMethod]: (request: Parameters<Designer[M]>[0]) => Promise<DesignReply> }> = {}) {}

  private async answer<M extends DesignMethod>(method: M, request: Parameters<Designer[M]>[0]): Promise<DesignReply> {
    this.calls.push({ method, request });
    await yieldToOthers();
    const reply = this.script[method] as ((request: Parameters<Designer[M]>[0]) => Promise<DesignReply>) | undefined;
    if (!reply) throw new AiUnavailableError();
    return reply(request);
  }

  designModel(request: Parameters<Designer["designModel"]>[0]) {
    return this.answer("designModel", request);
  }

  designMotion(request: Parameters<Designer["designMotion"]>[0]) {
    return this.answer("designMotion", request);
  }

  designEnvironment(request: Parameters<Designer["designEnvironment"]>[0]) {
    return this.answer("designEnvironment", request);
  }
}

export class MemoryAnswerCache implements AnswerCache {
  readonly answers = new Map<string, CachedAnswer>();

  async get(key: string): Promise<CachedAnswer | null> {
    await yieldToOthers();
    const found = this.answers.get(key);
    return found ? structuredClone(found) : null;
  }

  async put(key: string, value: CachedAnswer): Promise<void> {
    await yieldToOthers();
    this.answers.set(key, structuredClone(value));
  }
}

export class MemoryUsageLimits implements UsageLimits {
  readonly counts = new Map<string, number>();

  async take(uid: string, day: string, limits: { perPerson: number; total: number }): Promise<TakeResult> {
    await yieldToOthers();
    const person = personDocId(uid, day);
    const site = siteDocId(day);
    if ((this.counts.get(person) ?? 0) >= limits.perPerson) return "person-limit";
    if ((this.counts.get(site) ?? 0) >= limits.total) return "site-limit";
    this.counts.set(person, (this.counts.get(person) ?? 0) + 1);
    this.counts.set(site, (this.counts.get(site) ?? 0) + 1);
    return "ok";
  }

  async give(uid: string, day: string): Promise<void> {
    await yieldToOthers();
    for (const id of [personDocId(uid, day), siteDocId(day)]) this.counts.set(id, Math.max(0, (this.counts.get(id) ?? 0) - 1));
  }
}
