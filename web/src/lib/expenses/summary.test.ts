import { describe, expect, it } from "vitest";
import { costOf, pricesFromEnv, summarize, type UsageRecord } from "./summary";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
const rec = (kind: string, daysAgo: number, inputTokens: number, outputTokens: number): UsageRecord => ({ kind, at: NOW - daysAgo * DAY, inputTokens, outputTokens });

describe("summarize", () => {
  const records = [rec("script", 0, 1000, 4000), rec("model", 0, 500, 1500), rec("model", 1, 500, 1500), rec("script", 40, 9999, 9999)];
  const prices = { inputPerMillion: 3, outputPerMillion: 15 };

  it("adds up by day, newest first, and leaves out answers older than the window", () => {
    const s = summarize(records, prices, NOW, 30);
    expect(s.days.map((d) => [d.day, d.calls, d.inputTokens, d.outputTokens])).toEqual([
      ["2026-10-09", 2, 1500, 5500],
      ["2026-10-08", 1, 500, 1500],
    ]);
    expect(s.total).toMatchObject({ calls: 3, inputTokens: 2000, outputTokens: 7000 });
  });

  it("adds up by what the call was for, the one that used most first", () => {
    const s = summarize(records, prices, NOW, 30);
    expect(s.kinds.map((k) => [k.kind, k.calls, k.inputTokens + k.outputTokens])).toEqual([
      ["script", 1, 5000],
      ["model", 2, 4000],
    ]);
  });

  it("works out the cost from the prices, and gives none without prices", () => {
    expect(summarize(records, prices, NOW, 30).total.cost).toBeCloseTo((2000 / 1e6) * 3 + (7000 / 1e6) * 15, 10);
    expect(summarize(records, null, NOW, 30).total.cost).toBeNull();
    expect(costOf(1_000_000, 1_000_000, prices)).toBe(18);
  });

  it("ignores records with no usable token counts", () => {
    const s = summarize([{ kind: "x", at: NOW, inputTokens: Number.NaN, outputTokens: 5 }], prices, NOW, 30);
    expect(s.total.calls).toBe(0);
  });
});

describe("pricesFromEnv", () => {
  it("needs both prices to be numbers", () => {
    expect(pricesFromEnv({ AI_PRICE_INPUT_PER_MTOK: "3", AI_PRICE_OUTPUT_PER_MTOK: "15" })).toEqual({ inputPerMillion: 3, outputPerMillion: 15 });
    expect(pricesFromEnv({ AI_PRICE_INPUT_PER_MTOK: "3" })).toBeNull();
    expect(pricesFromEnv({ AI_PRICE_INPUT_PER_MTOK: "x", AI_PRICE_OUTPUT_PER_MTOK: "15" })).toBeNull();
    expect(pricesFromEnv({ AI_PRICE_INPUT_PER_MTOK: "-1", AI_PRICE_OUTPUT_PER_MTOK: "15" })).toBeNull();
    expect(pricesFromEnv({})).toBeNull();
  });
});
