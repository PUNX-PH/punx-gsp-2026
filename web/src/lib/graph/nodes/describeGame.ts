// The Describe Game node: the person's words, and a picture if one is wired in, become a game. Three modes (the Make a game setting): Script (Claude writes a
// Lua game for the player's interpreter), Rules (Claude writes a game of rules for the engine) and Off (only a palette and the three tuning numbers). All the
// rules (the cache, the limits, the model, checking the answer) are in the services it is given; this only passes things along.
import { designEntityAssets } from "@/lib/engine/assets";
import { paintingPalette } from "@/lib/graph/palette";
import { makeGameMode, perspectiveOf } from "@/lib/graph/registry";
import { type Executor, NodeError, type WireValue } from "@/lib/graph/types";

/** A game's one to five colors as the five a palette wire carries: the last one repeated. */
export const padPalette = (colors: string[]): string[] => Array.from({ length: 5 }, (_, i) => colors[Math.min(i, colors.length - 1)]);

export const describeGame: Executor = async (inputs, params, ctx) => {
  const prompt = params.prompt as string; // its shape was checked when the graph was saved; an empty one stops Play first
  const mode = makeGameMode(params.makeGame);

  let picture: { sha256: string; bytes: Uint8Array } | null = null;
  if (inputs.image?.type === "image") {
    const bytes = await ctx.readAsset(inputs.image.sha256);
    if (!bytes) throw new NodeError("Describe Game: the picture is missing. Choose it again.");
    picture = { sha256: inputs.image.sha256, bytes };
  }

  // Script (the default for new steps): Claude writes a Lua game, its five colors and the models it wants. There is no palette or feel port value: the
  // colors travel with the game, and Assemble Game puts them in the settings.
  if (mode === "script") {
    if (!ctx.scripts) throw new NodeError("Describe Game: making a whole game is not set up on this site yet.");
    const attempt = typeof params.attempt === "number" ? params.attempt : 0;
    const made = await ctx.scripts.create({ user: ctx.user, deadline: ctx.deadline }, { description: prompt, picture, models: [], attempt, perspective: perspectiveOf(params.perspective) });
    // The models Claude asked for are not built here: each is a Build Model step of its own in the graph (the site makes them from this answer), wired
    // to the Assemble Game's numbered model inputs in the order of `assets`, so each can be seen, changed and rebuilt.
    const outputs: Record<string, WireValue> = {
      game: { type: "game", script: made.script, palette: made.palette, leftOut: made.leftOut, assets: made.assets, entityFiles: [] },
      palette: { type: "palette", colors: made.palette },
    };
    return {
      outputs,
      result: { script: true, lines: made.script.split("\n").length, leftOut: made.leftOut, palette: made.palette, models: made.assets.map((a) => a.entity), reused: !made.asked },
    };
  }

  // Rules (and a saved true): Claude writes a whole game for the engine instead of a palette and a feel. The palette it chose is still offered, so a
  // Assemble Game without the game wire keeps its colors.
  if (mode === "rules") {
    if (!ctx.games) throw new NodeError("Describe Game: making a whole game is not set up on this site yet.");
    const made = await ctx.games.create({ user: ctx.user, deadline: ctx.deadline }, { description: prompt, picture, models: [] });
    const palette = padPalette(made.spec.look.palette);
    // The entities Claude asked art for are built now (one failing only makes that entity a plain shape).
    const art = await designEntityAssets(ctx.builder, { user: ctx.user, graphId: ctx.graphId, derived: ctx.derived, deadline: ctx.deadline }, made.assets, paintingPalette(palette));
    const outputs: Record<string, WireValue> = {
      game: { type: "game", spec: made.spec, leftOut: made.leftOut, assets: made.assets, entityFiles: art.files },
      palette: { type: "palette", colors: palette },
    };
    return {
      outputs,
      result: { game: true, entities: Object.keys(made.spec.entities).length, rules: made.spec.rules.length, leftOut: made.leftOut, palette, models: art.files.length, plainShapes: art.fallbacks, reused: !made.asked },
    };
  }

  const { answer, reused } = await ctx.ai.describe(ctx.user, { prompt, picture, deadline: ctx.deadline });
  return {
    outputs: {
      palette: { type: "palette", colors: answer.palette },
      feel: { type: "feel", tuning: answer.tuning },
    },
    result: { palette: answer.palette, tuning: answer.tuning, summary: answer.summary, reused },
  };
};
