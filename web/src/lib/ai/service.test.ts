import { describe, expect, it } from "vitest";
import { MemoryAnswerCache, MemoryUsageLimits } from "@/lib/ai/memory";
import { makeDescribeGameService } from "@/lib/ai/service";
import { AiRefusedError, AiUnavailableError, type DescribeGameModel } from "@/lib/ai/types";
import { NodeError } from "@/lib/graph/types";
import { minPlayableSpacing } from "@/lib/settings";
import { makePng } from "@/lib/testing/images";

const ALICE = { uid: "alice", email: "alice@punx.ai" };
const BOB = { uid: "bob", email: "bob@punx.ai" };

const PERSON = "Describe Game: You have used today's AI answers. Try again tomorrow.";
const SITE = "Describe Game: The AI is busy today. Try again tomorrow.";
const NOT_PLAYABLE = "Describe Game: The AI could not make a playable game from this. Try different words.";
const DECLINED = "Describe Game: The AI declined this request. Try different words.";
const NO_ANSWER = "Describe Game: The AI service did not answer. Try again.";
const DESCRIBE_FIRST = "Describe Game: Describe your game first.";

const raw = (change: (r: any) => void = () => {}) => { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = {
    palette: { background: "#1b1f3b", ground: "#ff6f59", panel: "#ffd166", accent: "#06d6a0", score: "#ffffff" },
    tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 },
    summary: "A fast neon night run.",
  };
  change(r);
  return r;
};

/** A model that answers from a script and remembers what it was asked. */
function fakeModel(reply: () => Promise<{ raw: unknown; usage: { inputTokens: number; outputTokens: number } }> = async () => ({ raw: raw(), usage: { inputTokens: 3000, outputTokens: 300 } })) {
  const asked: { prompt: string; picture: Uint8Array | null }[] = [];
  const model: DescribeGameModel = {
    async ask(request) {
      asked.push(request);
      return reply();
    },
  };
  return { model, asked };
}

function setup(options: { model?: ReturnType<typeof fakeModel>; perPerson?: number; total?: number; start?: number } = {}) {
  const cache = new MemoryAnswerCache();
  const limits = new MemoryUsageLimits();
  const scripted = options.model ?? fakeModel();
  const logs: object[] = [];
  const clock = { ms: options.start ?? Date.UTC(2026, 9, 4, 12) };
  const service = makeDescribeGameService({
    cache,
    limits,
    model: scripted.model,
    modelId: "claude-sonnet-5-5",
    perPerson: options.perPerson ?? 30,
    total: options.total ?? 300,
    now: () => clock.ms,
    log: (info) => logs.push(info),
  });
  return { service, cache, limits, scripted, logs, clock };
}

const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);
const noPicture = { prompt: "a fast neon night run", picture: null };

describe("the cache", () => {
  it("asks the model once for the same question, and says the second answer was reused", async () => {
    const { service, scripted } = setup();
    const first = await service.describe(ALICE, noPicture);
    const second = await service.describe(ALICE, noPicture);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.answer).toEqual(first.answer);
    expect(scripted.asked).toHaveLength(1);
  });

  it("asks again for another prompt, another picture, or another person", async () => {
    const { service, scripted } = setup();
    const picture = { sha256: "a".repeat(64), bytes: await makePng(20, 20, [9, 9, 9]) };
    await service.describe(ALICE, noPicture);
    await service.describe(ALICE, { prompt: "a slow spooky walk", picture: null });
    await service.describe(ALICE, { prompt: noPicture.prompt, picture });
    await service.describe(BOB, noPicture);
    expect(scripted.asked).toHaveLength(4);
  });

  it("gives a prompt with spaces and control characters around it the same answer, and sends the model the cleaned prompt (Review Focus 1)", async () => {
    const { service, scripted } = setup();
    await service.describe(ALICE, { prompt: "  a fast run\u0007 ", picture: null });
    const again = await service.describe(ALICE, { prompt: "a fast run", picture: null });
    expect(again.reused).toBe(true);
    expect(scripted.asked).toHaveLength(1);
    expect(scripted.asked[0].prompt).toBe("a fast run");
  });

  it("stores the checked answer with the model and the token counts", async () => {
    const { service, cache, clock } = setup();
    const { answer } = await service.describe(ALICE, noPicture);
    expect([...cache.answers.values()]).toEqual([{ answer, model: "claude-sonnet-5-5", createdAt: clock.ms, inputTokens: 3000, outputTokens: 300 }]);
  });

  it("still gives the answer when it cannot be stored", async () => {
    const { service, cache, logs } = setup();
    cache.put = async () => {
      throw new Error("firestore is down");
    };
    const { answer, reused } = await service.describe(ALICE, noPicture);
    expect(reused).toBe(false);
    expect(answer.summary).toBe("A fast neon night run.");
    expect(JSON.stringify(logs)).not.toContain("firestore is down");
  });
});

describe("the prompt", () => {
  it("says to describe the game when nothing but control characters is left of it, without asking the model or counting", async () => {
    const { service, scripted, limits } = setup({ perPerson: 1 });
    expect(await failure(service.describe(ALICE, { prompt: "\u0007\u0000", picture: null }))).toEqual(new NodeError(DESCRIBE_FIRST));
    expect(scripted.asked).toHaveLength(0);
    expect(await limits.take("alice", "20261004", { perPerson: 1, total: 10 })).toBe("ok"); // nothing was counted
  });
});

describe("the limits", () => {
  it("refuses a person after their daily limit, in plain words, without asking the model", async () => {
    const { service, scripted } = setup({ perPerson: 2 });
    await service.describe(ALICE, { prompt: "one", picture: null });
    await service.describe(ALICE, { prompt: "two", picture: null });
    expect(await failure(service.describe(ALICE, { prompt: "three", picture: null }))).toEqual(new NodeError(PERSON));
    expect(scripted.asked).toHaveLength(2);
  });

  it("does not count an answer that was reused", async () => {
    const { service } = setup({ perPerson: 1 });
    await service.describe(ALICE, noPicture);
    for (let i = 0; i < 5; i++) expect((await service.describe(ALICE, noPicture)).reused).toBe(true);
  });

  it("refuses everyone after the site's daily limit, with its own sentence", async () => {
    const { service } = setup({ total: 1 });
    await service.describe(ALICE, noPicture);
    expect(await failure(service.describe(BOB, noPicture))).toEqual(new NodeError(SITE));
  });

  it("starts again at UTC midnight", async () => {
    const { service, clock } = setup({ perPerson: 1, start: Date.UTC(2026, 9, 4, 23, 59, 59) });
    await service.describe(ALICE, { prompt: "one", picture: null });
    expect(await failure(service.describe(ALICE, { prompt: "two", picture: null }))).toEqual(new NodeError(PERSON));
    clock.ms += 2000;
    expect((await service.describe(ALICE, { prompt: "two", picture: null })).reused).toBe(false);
  });
});

describe("when the model cannot or will not answer", () => {
  it("says it declined, and keeps the count (the request was made)", async () => {
    const { service } = setup({
      perPerson: 1,
      model: fakeModel(async () => {
        throw new AiRefusedError();
      }),
    });
    expect(await failure(service.describe(ALICE, noPicture))).toEqual(new NodeError(DECLINED));
    expect(await failure(service.describe(ALICE, { prompt: "other words", picture: null }))).toEqual(new NodeError(PERSON));
  });

  it("says it did not answer, and gives the count back (it was not the person's doing)", async () => {
    let calls = 0;
    const { service } = setup({
      perPerson: 1,
      model: fakeModel(async () => {
        if (++calls === 1) throw new AiUnavailableError();
        return { raw: raw(), usage: { inputTokens: 1, outputTokens: 1 } };
      }),
    });
    expect(await failure(service.describe(ALICE, noPicture))).toEqual(new NodeError(NO_ANSWER));
    expect((await service.describe(ALICE, noPicture)).reused).toBe(false); // the place was given back, so this one is allowed
  });

  it("says the same for a failure nobody expected, gives the count back, and logs only its kind", async () => {
    const { service, logs } = setup({
      model: fakeModel(async () => {
        throw new Error("sk-secret-key rejected for a fast neon night run");
      }),
    });
    expect(await failure(service.describe(ALICE, noPicture))).toEqual(new NodeError(NO_ANSWER));
    expect(JSON.stringify(logs)).not.toContain("sk-secret-key");
    expect(logs).toContainEqual(expect.objectContaining({ outcome: "unexpected" }));
  });

  it("says the answer could not be played when it cannot be read, does not store it, and keeps the count", async () => {
    const { service, cache } = setup({ perPerson: 1, model: fakeModel(async () => ({ raw: undefined, usage: { inputTokens: 5, outputTokens: 5 } })) });
    expect(await failure(service.describe(ALICE, noPicture))).toEqual(new NodeError(NOT_PLAYABLE));
    expect(cache.answers.size).toBe(0);
    expect(await failure(service.describe(ALICE, { prompt: "again", picture: null }))).toEqual(new NodeError(PERSON));
  });

  it("stores and gives the repaired answer when only the spacing was wrong", async () => {
    const { service } = setup({ model: fakeModel(async () => ({ raw: raw((r) => (r.tuning = { speed: 12, jumpHeight: 3, obstacleSpacing: 4 })), usage: { inputTokens: 1, outputTokens: 1 } })) });
    const first = await service.describe(ALICE, noPicture);
    expect(first.answer.tuning.obstacleSpacing).toBe(minPlayableSpacing(12, 3));
    expect((await service.describe(ALICE, noPicture)).answer).toEqual(first.answer);
  });
});

describe("the picture", () => {
  it("sends the model a small JPEG, not the upload", async () => {
    const { service, scripted } = setup();
    const bytes = await makePng(3000, 2000, [200, 30, 30]);
    await service.describe(ALICE, { prompt: "a red run", picture: { sha256: "b".repeat(64), bytes } });
    const sent = scripted.asked[0].picture!;
    expect(Array.from(sent.slice(0, 3))).toEqual([0xff, 0xd8, 0xff]);
    expect(sent.length).toBeLessThan(bytes.length);
  });

  it("says why a picture cannot be used, in the reader's words, and gives the count back", async () => {
    const { service, scripted } = setup({ perPerson: 1 });
    const bad = { sha256: "c".repeat(64), bytes: new TextEncoder().encode("hello") };
    expect(await failure(service.describe(ALICE, { prompt: "a run", picture: bad }))).toEqual(new NodeError("Describe Game: this is not a PNG or JPEG picture"));
    expect(scripted.asked).toHaveLength(0);
    expect((await service.describe(ALICE, noPicture)).reused).toBe(false); // the place was given back
  });
});

describe("what is logged", () => {
  it("is the step, the outcome and the token counts, never the prompt, the picture, the answer or the key", async () => {
    const { service, logs } = setup();
    const bytes = await makePng(30, 30, [1, 2, 3]);
    await service.describe(ALICE, { prompt: "a very private neon night run", picture: { sha256: "d".repeat(64), bytes } });
    await service.describe(ALICE, { prompt: "a very private neon night run", picture: { sha256: "d".repeat(64), bytes } });
    const text = JSON.stringify(logs);
    expect(text).not.toContain("private");
    expect(text).not.toContain("A fast neon night run");
    expect(text).not.toContain("#ff6f59");
    expect(logs).toEqual([
      { step: "describe-game", outcome: "answered", inputTokens: 3000, outputTokens: 300 },
      { step: "describe-game", outcome: "reused" },
    ]);
  });
});
