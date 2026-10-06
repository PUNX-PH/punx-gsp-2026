// The Preview node: the one node with a side effect. It stores the game as an ordinary run (through the slice 2 run
// service), so the existing Preview page plays it, and it replaces the graph's earlier run, so a graph never holds
// more than one. Everything that can fail without side effects (reading the models) happens first.
import { builtinModel } from "@/lib/graph/builtin";
import { type Executor, NodeError, ROLE_FILES, type Role } from "@/lib/graph/types";
import { RunError } from "@/lib/runs/types";

const ROLES = Object.keys(ROLE_FILES) as Role[];

const refusal = (error: unknown) => (error instanceof RunError ? new NodeError(`Preview: ${error.message}`) : error);

export const preview: Executor = async (inputs, _params, ctx) => {
  const game = inputs.settings;
  if (game?.type !== "settings") throw new Error("Preview was run without its game"); // Play checks this first

  const models: [string, Uint8Array][] = [];
  for (const role of ROLES) {
    const source = game.models[role];
    const bytes = source.kind === "asset" ? await ctx.readAsset(source.sha256) : builtinModel(source.role);
    if (!bytes) throw new NodeError("Preview: a model file is missing. Choose it again.");
    models.push([ROLE_FILES[role], bytes]);
  }
  // The scenery of a game with an environment, after the roles' files, read before anything is stored.
  for (const piece of game.scenery ?? []) {
    const bytes = await ctx.readAsset(piece.sha256);
    if (!bytes) throw new NodeError("Preview: a model file is missing. Choose it again.");
    models.push([piece.file, bytes]);
  }

  // The earlier run goes first, which also frees its place under the 20-run cap. Someone may have deleted it already.
  const earlier = ctx.lastRun.get();
  if (earlier) {
    try {
      await ctx.runs.deleteRun(ctx.user, earlier);
    } catch (error) {
      if (!(error instanceof RunError && error.status === 404)) throw error;
    }
    ctx.lastRun.set(null);
  }

  let runId: string;
  try {
    runId = (await ctx.runs.createRun(ctx.user, game.settingsText)).id;
  } catch (error) {
    throw refusal(error);
  }

  try {
    for (const [name, bytes] of models) await ctx.runs.putFile(ctx.user, runId, name, bytes);
  } catch (error) {
    await ctx.runs.deleteRun(ctx.user, runId).catch(() => {}); // best effort: a half-stored run is cleaned up after an hour anyway
    throw refusal(error);
  }

  ctx.lastRun.set(runId);
  return { result: { runId } };
};
