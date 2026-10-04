// The contract the AI answer cache and the usage limits must keep. It runs against the in-memory fakes here; the Firestore
// adapters are held to the same rules by being written to the same ports, and are first exercised on the deployment.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ANSWER_VERSION, answerKey, dayOf, personDocId, siteDocId } from "@/lib/ai/key";
import { MemoryAnswerCache, MemoryUsageLimits } from "@/lib/ai/memory";
import type { CachedAnswer } from "@/lib/ai/ports";

const input = { model: "claude-sonnet-5-5", uid: "alice", prompt: "a fast run", pictureSha: null as string | null };

describe("answerKey", () => {
  it("is a SHA-256 of the version, model, person, prompt and picture hash, and the same for the same inputs", async () => {
    const expected = createHash("sha256").update(JSON.stringify([ANSWER_VERSION, input.model, input.uid, input.prompt, input.pictureSha])).digest("hex");
    expect(await answerKey(input)).toBe(expected);
    expect(await answerKey({ ...input })).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each<[string, Partial<typeof input>]>([
    ["the model", { model: "claude-opus-5-5" }],
    ["the person", { uid: "bob" }],
    ["the prompt", { prompt: "a slow run" }],
    ["the picture", { pictureSha: "a".repeat(64) }],
  ])("changes with %s", async (_label, change) => {
    expect(await answerKey({ ...input, ...change })).not.toBe(await answerKey(input));
  });

  it("cannot be fooled by text that runs one field into the next", async () => {
    expect(await answerKey({ ...input, uid: "a", prompt: "bc" })).not.toBe(await answerKey({ ...input, uid: "ab", prompt: "c" }));
  });
});

describe("dayOf, and the ids of the usage documents", () => {
  it("is the UTC date as yyyymmdd, and changes exactly at UTC midnight", () => {
    expect(dayOf(Date.UTC(2026, 9, 4, 23, 59, 59, 999))).toBe("20261004");
    expect(dayOf(Date.UTC(2026, 9, 5, 0, 0, 0, 0))).toBe("20261005");
    expect(dayOf(Date.UTC(2026, 0, 1))).toBe("20260101");
  });

  it("names a person's day and the site's day apart, and refuses a person id Firestore would not take", () => {
    expect(personDocId("alice", "20261004")).toBe("u_alice_20261004");
    expect(siteDocId("20261004")).toBe("site_20261004");
    expect(() => personDocId("", "20261004")).toThrow();
    expect(() => personDocId("a/b", "20261004")).toThrow();
  });
});

const cached = (summary = "A fast run."): CachedAnswer => ({
  answer: { palette: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"], tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 }, summary },
  model: "claude-sonnet-5-5",
  createdAt: 1,
  inputTokens: 3000,
  outputTokens: 300,
});

describe("the answer cache", () => {
  it("says null for a key it has not seen, and gives back what was put", async () => {
    const cache = new MemoryAnswerCache();
    expect(await cache.get("k1")).toBeNull();
    await cache.put("k1", cached());
    expect(await cache.get("k1")).toEqual(cached());
    expect(await cache.get("k2")).toBeNull();
  });

  it("keeps copies, so a caller cannot change what is stored", async () => {
    const cache = new MemoryAnswerCache();
    await cache.put("k1", cached());
    const read = (await cache.get("k1"))!;
    read.answer.summary = "changed";
    expect((await cache.get("k1"))?.answer.summary).toBe("A fast run.");
  });
});

describe("the usage limits", () => {
  const DAY = "20261004";
  const LIMITS = { perPerson: 3, total: 5 };

  it("lets a person take up to the limit, then says so", async () => {
    const limits = new MemoryUsageLimits();
    for (let i = 0; i < 3; i++) expect(await limits.take("alice", DAY, LIMITS)).toBe("ok");
    expect(await limits.take("alice", DAY, LIMITS)).toBe("person-limit");
  });

  it("counts the whole site as well, and a refused take counts for nothing", async () => {
    const limits = new MemoryUsageLimits();
    for (let i = 0; i < 3; i++) await limits.take("alice", DAY, LIMITS);
    expect(await limits.take("alice", DAY, LIMITS)).toBe("person-limit"); // refused: not counted towards the site's 5
    expect(await limits.take("bob", DAY, LIMITS)).toBe("ok");
    expect(await limits.take("bob", DAY, LIMITS)).toBe("ok");
    expect(await limits.take("bob", DAY, LIMITS)).toBe("site-limit"); // 3 + 2 = 5 taken
    expect(await limits.take("carol", DAY, LIMITS)).toBe("site-limit");
  });

  it("says person-limit when both limits are reached", async () => {
    const limits = new MemoryUsageLimits();
    for (let i = 0; i < 3; i++) await limits.take("alice", DAY, { perPerson: 3, total: 3 });
    expect(await limits.take("alice", DAY, { perPerson: 3, total: 3 })).toBe("person-limit");
  });

  it("gives a place back to the person and the site, and never goes below zero", async () => {
    const limits = new MemoryUsageLimits();
    for (let i = 0; i < 3; i++) await limits.take("alice", DAY, LIMITS);
    await limits.give("alice", DAY);
    expect(await limits.take("alice", DAY, LIMITS)).toBe("ok");
    expect(await limits.take("alice", DAY, LIMITS)).toBe("person-limit");

    const fresh = new MemoryUsageLimits();
    await fresh.give("bob", DAY);
    await fresh.give("bob", DAY);
    for (let i = 0; i < 3; i++) expect(await fresh.take("bob", DAY, LIMITS)).toBe("ok");
    expect(await fresh.take("bob", DAY, LIMITS)).toBe("person-limit"); // the extra gives did not make room
  });

  it("starts a new day at zero", async () => {
    const limits = new MemoryUsageLimits();
    for (let i = 0; i < 3; i++) await limits.take("alice", DAY, LIMITS);
    expect(await limits.take("alice", DAY, LIMITS)).toBe("person-limit");
    expect(await limits.take("alice", "20261005", LIMITS)).toBe("ok");
  });

  it("lets exactly the limit's worth of simultaneous takes through", async () => {
    const limits = new MemoryUsageLimits();
    const results = await Promise.all(Array.from({ length: 40 }, () => limits.take("alice", DAY, { perPerson: 30, total: 1000 })));
    expect(results.filter((r) => r === "ok")).toHaveLength(30);
    expect(results.filter((r) => r === "person-limit")).toHaveLength(10);

    const site = new MemoryUsageLimits();
    const many = await Promise.all(Array.from({ length: 40 }, (_, i) => site.take(`person${i}`, DAY, { perPerson: 30, total: 25 })));
    expect(many.filter((r) => r === "ok")).toHaveLength(25);
    expect(many.filter((r) => r === "site-limit")).toHaveLength(15);
  });
});
