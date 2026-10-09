// The Game Template node: turns the palette, the models and the tuning into a runner game's settings. It stores
// nothing (the Preview does); it only builds the settings and checks them exactly as the Unity template will.
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { entityFile, entityFilesNeeded, usesFile } from "@/lib/engine/files";
import type { GameSpec } from "@/lib/engine/spec";
import { padPalette } from "@/lib/graph/nodes/describeGame";
import { SCRIPT_MODEL_PORTS } from "@/lib/graph/registry";
import { SCRIPT_FILE } from "@/lib/script/api";
import { checkScript } from "@/lib/script/check";
import { type Executor, type ModelSource, NodeError, ROLE_FILES, type Role, SCENERY_FILES, type Tuning, type WireValue } from "@/lib/graph/types";
import { validateSettings, WORLD_FILES } from "@/lib/settings";

const ROLES = Object.keys(ROLE_FILES) as Role[];

const article = (role: Role) => (role === "obstacle" ? "an" : "a");

/** A whole game from Describe Game: the settings are the spec plus filler for the runner fields, and the run holds only the entities' files. */
function gameSettings(game: Extract<WireValue, { type: "game"; spec: GameSpec }>) {
  const have = new Set(game.entityFiles.map((f) => f.file));
  // An entity that names a model but has no file (its build failed or was not made) is drawn as a box.
  const entities = Object.fromEntries(
    Object.entries(game.spec.entities).map(([name, e]) => [name, usesFile(e.model) && !e.behaviors.some((b) => b.type === "spawn") && !have.has(entityFile(name)) ? { ...e, model: "box" } : e]),
  );
  const spec = { ...game.spec, entities };
  const tuning: Tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
  const checked = validateSettings(JSON.stringify({ schemaVersion: 1, template: "runner", palette: padPalette(spec.look.palette), roles: ROLE_FILES, tuning, game: spec }));
  if (!checked.ok) throw new NodeError(`Game Template: ${checked.error}`);
  const needed = new Set(entityFilesNeeded(spec));
  const models = Object.fromEntries(ROLES.map((role): [Role, ModelSource] => [role, { kind: "builtin", role }])) as Record<Role, ModelSource>;
  return {
    output: { type: "settings" as const, settingsText: checked.text, tuning, models, entityFiles: game.entityFiles.filter((f) => needed.has(f.file)) },
    result: { game: true, entities: Object.keys(spec.entities).length },
  };
}

/**
 * A Lua game from Describe Game: the settings name game.lua and the models that were built (the others are drawn as boxes by the player), with the
 * game's five colors and the runner's fields as filler; the script itself travels on the settings wire and Preview stores it as game.lua.
 */
function scriptSettings(game: Extract<WireValue, { type: "game"; script: string }>, inputs: Partial<Record<string, WireValue>>) {
  const checkedScript = checkScript(game.script);
  if (!checkedScript.ok) throw new NodeError(`Game Template: ${checkedScript.reason}`);
  // A model comes from a numbered input (the Nth model Describe Game listed) or, for a game that carried its own files, from the wire.
  const files = [...game.entityFiles];
  game.assets.slice(0, SCRIPT_MODEL_PORTS).forEach((asset, i) => {
    const given = inputs[`model${i + 1}`];
    if (given?.type !== "model") return;
    if (given.format !== "glb") throw new NodeError(`Game Template: model ${i + 1} is an ${given.format.toUpperCase()} file. Put a Prepare Model step after it.`);
    if (!files.some((f) => f.file === entityFile(asset.entity))) files.push({ file: entityFile(asset.entity), sha256: given.sha256, ...(given.mobile ? { mobile: given.mobile.sha256 } : {}) });
  });
  const have = new Set(files.map((f) => f.file));
  const names = game.assets.map((a) => a.entity).filter((name) => have.has(entityFile(name)));
  const tuning: Tuning = { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 };
  // A connected environment gives the game its world: the sky, the ground's color and scenery along the field (the scenery files go in the run under fixed names).
  const world = inputs.environment?.type === "environment" ? inputs.environment : null;
  const scenery = world ? world.scenery.slice(0, SCENERY_FILES.length).map((piece, index) => ({ file: SCENERY_FILES[index], sha256: piece.sha256 })) : [];
  const environment = world && scenery.length > 0 ? { sky: world.sky, field: world.field, stripe: world.stripe, density: world.density, scenery: scenery.map((s) => s.file) } : undefined;
  const checked = validateSettings(
    JSON.stringify({ schemaVersion: 1, template: "runner", palette: game.palette, roles: ROLE_FILES, tuning, script: { file: SCRIPT_FILE, models: names }, ...(environment ? { environment } : {}) }),
  );
  if (!checked.ok) throw new NodeError(`Game Template: ${checked.error}`);
  const needed = new Set(names.map(entityFile));
  const models = Object.fromEntries(ROLES.map((role): [Role, ModelSource] => [role, { kind: "builtin", role }])) as Record<Role, ModelSource>;
  return {
    output: {
      type: "settings" as const,
      settingsText: checked.text,
      tuning,
      models,
      entityFiles: files.filter((f) => needed.has(f.file)),
      script: game.script,
      ...(scenery.length > 0 ? { scenery } : {}),
    },
    result: { script: true, models: names.length },
  };
}

export const gameTemplate: Executor = async (inputs, params) => {
  if (inputs.game?.type === "game") return "script" in inputs.game ? scriptSettings(inputs.game, inputs) : gameSettings(inputs.game);
  // A connected feel replaces the sliders for this run (the saved setting is left alone, so unplugging it brings them back).
  // Either way the numbers are checked below like any others; the settings' own shape was checked when the graph was saved.
  const { speed, jumpHeight, obstacleSpacing } = inputs.feel?.type === "feel" ? inputs.feel.tuning : (params.tuning as Tuning);
  const tuning: Tuning = { speed, jumpHeight, obstacleSpacing };

  const palette = inputs.palette?.type === "palette" ? inputs.palette.colors : [...SAMPLE_PALETTE];
  const models = Object.fromEntries(
    ROLES.map((role): [Role, ModelSource] => {
      const given = inputs[role];
      // Only a GLB can go into a game as it is: an FBX or an OBJ has to be prepared first.
      if (given?.type === "model" && given.format !== "glb") {
        throw new NodeError(`Game Template: the ${role} model is an ${given.format.toUpperCase()} file. Put a Prepare Model step after it.`);
      }
      // A built model knows what it was built for (an obstacle has no Run clip to play): a mismatch is the person's to fix.
      if (given?.type === "model" && given.role !== undefined && given.role !== role) {
        throw new NodeError(`Game Template: the ${role} model was built as ${article(given.role)} ${given.role}. Set its role to ${role}.`);
      }
      return [role, given?.type === "model" ? { kind: "asset", sha256: given.sha256 } : { kind: "builtin", role }];
    }),
  ) as Record<Role, ModelSource>;

  // A connected environment adds the world to the settings (after the tuning, so the rest of the text is what it always was). Its scenery
  // goes in the run under fixed names, the first three pieces in order. Without one the settings are exactly what they were.
  const world = inputs.environment?.type === "environment" ? inputs.environment : null;
  const scenery = world ? world.scenery.slice(0, SCENERY_FILES.length).map((piece, index) => ({ file: SCENERY_FILES[index], sha256: piece.sha256 })) : null;
  // A High environment with a world adds the world's style (last in the environment) and its three files go in the run under fixed names.
  const worldFiles = world?.quality === "high" && world.world ? WORLD_FILES.map((file) => ({ file, sha256: world.world![file.slice(0, -4) as "terrain" | "road" | "backdrop"] })) : null;
  const environment =
    world && scenery
      ? { sky: world.sky, field: world.field, stripe: world.stripe, density: world.density, scenery: scenery.map((s) => s.file), ...(worldFiles && world.world ? { world: { style: world.world.style } } : {}) }
      : undefined;
  // The game is lit when any model it uses, or its environment, is High (last in the text, so a Standard game's text is what it always was).
  const lit = ROLES.some((role) => inputs[role]?.type === "model" && inputs[role].quality === "high") || world?.quality === "high";

  const checked = validateSettings(
    JSON.stringify({ schemaVersion: 1, template: "runner", palette, roles: ROLE_FILES, tuning, ...(environment ? { environment } : {}), ...(lit ? { look: "lit" } : {}) }),
  );
  if (!checked.ok) throw new NodeError(`Game Template: ${checked.error}`);

  return { output: { type: "settings", settingsText: checked.text, tuning, models, ...(scenery ? { scenery } : {}), ...(worldFiles ? { world: worldFiles } : {}) }, result: { tuning } };
};
