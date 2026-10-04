import { describe, expect, it } from "vitest";
import type { DescribedGame, DescribeGameService } from "@/lib/ai/types";
import { describeGame } from "@/lib/graph/nodes/describeGame";
import { type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";

const answer: DescribedGame = {
  palette: ["#1b1f3b", "#ff6f59", "#ffd166", "#06d6a0", "#ffffff"],
  tuning: { speed: 7, jumpHeight: 2.6, obstacleSpacing: 18 },
  summary: "A fast neon night run.",
};
const SHA = "e".repeat(64);
const picture: WireValue = { type: "image", sha256: SHA, name: "p.png", width: 10, height: 10 };
const user = { uid: "alice", email: "alice@punx.ai" };

/** A context whose AI service remembers what it was asked. */
function context(files: Record<string, Uint8Array> = {}, reused = false) {
  const asked: { prompt: string; picture: { sha256: string; bytes: Uint8Array } | null }[] = [];
  const ai: DescribeGameService = {
    async describe(_user, input) {
      asked.push(input);
      return { answer, reused };
    },
  };
  const ctx = { user, ai, readAsset: async (sha: string) => files[sha] ?? null } as unknown as ExecutorContext;
  return { ctx, asked };
}

describe("the Describe Game node", () => {
  it("gives a palette and a feel, each on its own port, and the answer as its result", async () => {
    const { ctx } = context();
    const done = await describeGame({}, { prompt: "a fast neon night run" }, ctx);

    expect(done.outputs).toEqual({
      palette: { type: "palette", colors: answer.palette },
      feel: { type: "feel", tuning: answer.tuning },
    });
    expect(done.output).toBeUndefined();
    expect(done.result).toEqual({ palette: answer.palette, tuning: answer.tuning, summary: answer.summary, reused: false });
  });

  it("asks with the person's prompt and no picture when none is wired", async () => {
    const { ctx, asked } = context();
    await describeGame({}, { prompt: "a fast neon night run" }, ctx);
    expect(asked).toEqual([{ prompt: "a fast neon night run", picture: null }]);
  });

  it("asks with the picture's bytes and hash when one is wired", async () => {
    const bytes = Uint8Array.from([1, 2, 3]);
    const { ctx, asked } = context({ [SHA]: bytes });
    await describeGame({ image: picture }, { prompt: "a run" }, ctx);
    expect(asked).toEqual([{ prompt: "a run", picture: { sha256: SHA, bytes } }]);
  });

  it("says when the picture is gone, without asking the AI", async () => {
    const { ctx, asked } = context({});
    const failure = await describeGame({ image: picture }, { prompt: "a run" }, ctx).then(() => null, (e: unknown) => e);
    expect(failure).toEqual(new NodeError("Describe Game: the picture is missing. Choose it again."));
    expect(asked).toHaveLength(0);
  });

  it("says in its result when the answer was reused", async () => {
    const { ctx } = context({}, true);
    expect((await describeGame({}, { prompt: "a run" }, ctx)).result).toMatchObject({ reused: true });
  });

  it("lets the AI service's own plain failure through", async () => {
    const ai: DescribeGameService = {
      async describe() {
        throw new NodeError("Describe Game: The AI service did not answer. Try again.");
      },
    };
    const ctx = { user, ai, readAsset: async () => null } as unknown as ExecutorContext;
    await expect(describeGame({}, { prompt: "a run" }, ctx)).rejects.toEqual(new NodeError("Describe Game: The AI service did not answer. Try again."));
  });
});
