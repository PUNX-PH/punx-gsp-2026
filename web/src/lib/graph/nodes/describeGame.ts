// The Describe Game node: the person's words, and a picture if one is wired in, become a palette and a feel. All the rules
// (the cache, the limits, the model, checking the answer) are in the AI service it is given; this only passes things along.
import { type Executor, NodeError } from "@/lib/graph/types";

export const describeGame: Executor = async (inputs, params, ctx) => {
  const prompt = params.prompt as string; // its shape was checked when the graph was saved; an empty one stops Play first

  let picture: { sha256: string; bytes: Uint8Array } | null = null;
  if (inputs.image?.type === "image") {
    const bytes = await ctx.readAsset(inputs.image.sha256);
    if (!bytes) throw new NodeError("Describe Game: the picture is missing. Choose it again.");
    picture = { sha256: inputs.image.sha256, bytes };
  }

  const { answer, reused } = await ctx.ai.describe(ctx.user, { prompt, picture });
  return {
    outputs: {
      palette: { type: "palette", colors: answer.palette },
      feel: { type: "feel", tuning: answer.tuning },
    },
    result: { palette: answer.palette, tuning: answer.tuning, summary: answer.summary, reused },
  };
};
