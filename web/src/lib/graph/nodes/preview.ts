// The Preview node: the one node with a side effect. It stores the game as an ordinary run (through the slice 2 run
// service), so the existing Preview page plays it, and it replaces the graph's earlier run, so a graph never holds
// more than one. Everything that can fail without side effects (reading the models) happens first.
import { mobileFile } from "@/lib/engine/files";
import { builtinModel } from "@/lib/graph/builtin";
import { SCRIPT_FILE } from "@/lib/script/api";
import { type Executor, NodeError, ROLE_FILES, type Role } from "@/lib/graph/types";
import { RunError } from "@/lib/runs/types";

const ROLES = Object.keys(ROLE_FILES) as Role[];

const refusal = (error: unknown) => (error instanceof RunError ? new NodeError(`Preview: ${error.message}`) : error);

export const preview: Executor = async (inputs, _params, ctx) => {
  const game = inputs.settings;
  if (game?.type !== "settings") throw new Error("Preview was run without its game"); // Play checks this first

  const models: [string, Uint8Array][] = [];
  // An engine game's run holds only its entities' files; the runner's role files are not part of it.
  for (const role of game.entityFiles ? [] : ROLES) {
    const source = game.models[role];
    const bytes = source.kind === "asset" ? await ctx.readAsset(source.sha256) : builtinModel(source.role);
    if (!bytes) throw new NodeError("Preview: a model file is missing. Choose it again.");
    models.push([ROLE_FILES[role], bytes]);
  }
  // A script game's run holds its Lua text first (as game.lua), then the models' files.
  if (game.script !== undefined) models.push([SCRIPT_FILE, new TextEncoder().encode(game.script)]);
  // The scenery of a game with an environment, then the files of its world, after the roles' files, read before anything is stored.
  for (const piece of [...(game.entityFiles ?? []), ...(game.scenery ?? []), ...(game.world ?? [])]) {
    const bytes = await ctx.readAsset(piece.sha256);
    if (!bytes) throw new NodeError("Preview: a model file is missing. Choose it again.");
    models.push([piece.file, bytes]);
  }

  // The phone variants of the entities' models come last (a run is ready once its own files are there; these are extras the Android export prefers).
  for (const piece of game.entityFiles ?? []) {
    if (piece.mobile === undefined) continue;
    const bytes = await ctx.readAsset(piece.mobile);
    if (!bytes) throw new NodeError("Preview: a model file is missing. Choose it again.");
    models.push([mobileFile(piece.file), bytes]);
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
