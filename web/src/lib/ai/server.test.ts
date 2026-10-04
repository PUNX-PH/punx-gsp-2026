import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryAnswerCache, MemoryUsageLimits } from "@/lib/ai/memory";
import { aiConfigFromEnv, getDescribeGameService, logOutcome } from "@/lib/ai/server";
import { NodeError } from "@/lib/graph/types";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("aiConfigFromEnv", () => {
  it("has the defaults when nothing is set: Claude Sonnet 5.5, 30 a person a day, 300 a day for the site", () => {
    expect(aiConfigFromEnv({})).toEqual({ modelId: "claude-sonnet-5-5", perPerson: 30, total: 300 });
  });

  it("takes a model and the two limits from the environment", () => {
    expect(aiConfigFromEnv({ AI_MODEL: "claude-opus-5-5", AI_DAILY_LIMIT_PER_PERSON: "5", AI_DAILY_LIMIT_TOTAL: "50" })).toEqual({
      modelId: "claude-opus-5-5",
      perPerson: 5,
      total: 50,
    });
  });

  it.each([["empty", ""], ["text", "abc"], ["negative", "-5"], ["fractional", "1.5"], ["with spaces", " 7 "], ["scientific", "1e3"], ["unset", undefined]])(
    "falls back to the default for a limit that is %s",
    (_label, value) => {
      expect(aiConfigFromEnv({ AI_DAILY_LIMIT_PER_PERSON: value, AI_DAILY_LIMIT_TOTAL: value })).toMatchObject({ perPerson: 30, total: 300 });
    },
  );

  it("accepts 0 (a way to switch a limit off for everyone), and ignores an empty model name", () => {
    expect(aiConfigFromEnv({ AI_DAILY_LIMIT_PER_PERSON: "0", AI_MODEL: "" })).toMatchObject({ perPerson: 0, modelId: "claude-sonnet-5-5" });
  });
});

describe("getDescribeGameService", () => {
  const fakes = () => ({ cache: new MemoryAnswerCache(), limits: new MemoryUsageLimits() });
  const alice = { uid: "alice", email: "alice@punx.ai" };

  it("can be made with nothing in the environment: nothing is read or connected until an answer is asked for (Review Focus 4)", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(() => getDescribeGameService(fakes())).not.toThrow();
  });

  it("says the AI service did not answer, in plain words, when there is no key, and does not keep the count", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const service = getDescribeGameService(fakes());

    const failure = await service.describe(alice, { prompt: "a fast neon run", picture: null }).then(() => null, (e: unknown) => e);

    expect(failure).toEqual(new NodeError("Describe Game: The AI service did not answer. Try again."));
  });
});

describe("logOutcome", () => {
  it("logs successes quietly and failures as errors, with the same plain fields", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logOutcome({ step: "describe-game", outcome: "answered", inputTokens: 1, outputTokens: 2 });
    logOutcome({ step: "describe-game", outcome: "reused" });
    logOutcome({ step: "describe-game", outcome: "person-limit" });
    expect(info).toHaveBeenCalledTimes(3);
    expect(error).not.toHaveBeenCalled();

    logOutcome({ step: "describe-game", outcome: "unavailable", status: 401 });
    logOutcome({ step: "describe-game", outcome: "unexpected", kind: "Error" });
    logOutcome({ step: "describe-game", outcome: "bad-answer" });
    logOutcome({ step: "describe-game", outcome: "cache-write-failed" });
    expect(error).toHaveBeenCalledTimes(4);
    expect(error.mock.calls[0]).toEqual(["describe game", { step: "describe-game", outcome: "unavailable", status: 401 }]);
  });
});
