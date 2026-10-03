// The Game Template node: turns the palette, the models and the tuning into a runner game's settings. It stores
// nothing (the Preview does); it only builds the settings and checks them exactly as the Unity template will.
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type Executor, type ModelSource, NodeError, ROLE_FILES, type Role, type Tuning } from "@/lib/graph/types";
import { validateSettings } from "@/lib/settings";

const ROLES = Object.keys(ROLE_FILES) as Role[];

export const gameTemplate: Executor = async (inputs, params) => {
  const { speed, jumpHeight, obstacleSpacing } = params.tuning as Tuning; // its shape was checked when the graph was saved
  const tuning: Tuning = { speed, jumpHeight, obstacleSpacing };

  const palette = inputs.palette?.type === "palette" ? inputs.palette.colors : [...SAMPLE_PALETTE];
  const models = Object.fromEntries(
    ROLES.map((role): [Role, ModelSource] => {
      const given = inputs[role];
      return [role, given?.type === "model" ? { kind: "asset", sha256: given.sha256 } : { kind: "builtin", role }];
    }),
  ) as Record<Role, ModelSource>;

  const checked = validateSettings(JSON.stringify({ schemaVersion: 1, template: "runner", palette, roles: ROLE_FILES, tuning }));
  if (!checked.ok) throw new NodeError(`Game Template: ${checked.error}`);

  return { output: { type: "settings", settingsText: checked.text, tuning, models }, result: { tuning } };
};
