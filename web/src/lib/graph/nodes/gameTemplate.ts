// The Game Template node: turns the palette, the models and the tuning into a runner game's settings. It stores
// nothing (the Preview does); it only builds the settings and checks them exactly as the Unity template will.
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type Executor, type ModelSource, NodeError, ROLE_FILES, type Role, SCENERY_FILES, type Tuning } from "@/lib/graph/types";
import { validateSettings } from "@/lib/settings";

const ROLES = Object.keys(ROLE_FILES) as Role[];

const article = (role: Role) => (role === "obstacle" ? "an" : "a");

export const gameTemplate: Executor = async (inputs, params) => {
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
  const environment = world && scenery ? { sky: world.sky, field: world.field, stripe: world.stripe, density: world.density, scenery: scenery.map((s) => s.file) } : undefined;

  const checked = validateSettings(JSON.stringify({ schemaVersion: 1, template: "runner", palette, roles: ROLE_FILES, tuning, ...(environment ? { environment } : {}) }));
  if (!checked.ok) throw new NodeError(`Game Template: ${checked.error}`);

  return { output: { type: "settings", settingsText: checked.text, tuning, models, ...(scenery ? { scenery } : {}) }, result: { tuning } };
};
