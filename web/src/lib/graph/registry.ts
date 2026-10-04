// The closed list of node types: what each is called, what its ports carry, and how its settings are checked. Graphs
// name node types by id only, so nothing in a graph can add behavior. The plain names and one-line help are here so
// that every screen (and every error message) uses the same words.
import type { WireType } from "@/lib/graph/types";

export interface PortSpec {
  name: string;
  label: string; // plain name, e.g. "picture"
  help: string; // one line
  type: WireType;
  required: boolean;
  missing?: string; // the full sentence for a required input that is not connected
}

export interface NodeSpec {
  type: string;
  label: string;
  help: string;
  /** The node the graph runs towards (the Preview). Only nodes that lead to it are run. */
  final: boolean;
  inputs: PortSpec[];
  outputs: PortSpec[];
  defaultParams(): Record<string, unknown>;
  /** Whether the settings are well formed (checked on save). Returns a sentence, or null. */
  shapeProblem(params: Record<string, unknown>): string | null;
  /** Whether the settings are finished enough to run (checked on Play). Returns a sentence, or null. */
  incompleteProblem(params: Record<string, unknown>): string | null;
}

/** How each wire type is named to a person. */
export const WIRE_WORDS: Record<WireType, string> = { image: "picture", model: "3D model", palette: "palette", feel: "feel", settings: "game" };

const SHA256_HEX = /^[0-9a-f]{64}$/;

const hasExactly = (params: Record<string, unknown>, keys: string[]) =>
  Object.keys(params).length === keys.length && keys.every((k) => Object.hasOwn(params, k));

const noParams = (params: Record<string, unknown>) => (Object.keys(params).length === 0 ? null : "takes no settings.");

function fileParam(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["asset"])) return "asset is the only setting a file node has.";
  const { asset } = params;
  return asset === null || (typeof asset === "string" && SHA256_HEX.test(asset)) ? null : "asset must be an uploaded file, or nothing yet.";
}

function tuningParam(params: Record<string, unknown>): string | null {
  const bad = "tuning must have speed, jumpHeight and obstacleSpacing, each a finite number.";
  if (!hasExactly(params, ["tuning"])) return bad;
  const tuning = params.tuning;
  if (typeof tuning !== "object" || tuning === null || Array.isArray(tuning)) return bad;
  const t = tuning as Record<string, unknown>;
  if (!hasExactly(t, ["speed", "jumpHeight", "obstacleSpacing"])) return bad;
  return ["speed", "jumpHeight", "obstacleSpacing"].every((k) => typeof t[k] === "number" && Number.isFinite(t[k])) ? null : bad;
}

const port = (name: string, label: string, help: string, type: WireType, required = false, missing?: string): PortSpec => ({
  name,
  label,
  help,
  type,
  required,
  ...(missing ? { missing } : {}),
});

export const NODE_SPECS: Record<string, NodeSpec> = {
  "reference-image": {
    type: "reference-image",
    label: "Reference Image",
    help: "The picture the game's colors come from.",
    final: false,
    inputs: [],
    outputs: [port("image", "picture", "The picture you chose.", "image")],
    defaultParams: () => ({ asset: null }),
    shapeProblem: fileParam,
    incompleteProblem: (params) => (params.asset === null ? "choose a picture." : null),
  },
  model: {
    type: "model",
    label: "3D Model",
    help: "A model of your own, as a GLB file.",
    final: false,
    inputs: [],
    outputs: [port("model", "3D model", "Your model.", "model")],
    defaultParams: () => ({ asset: null }),
    shapeProblem: fileParam,
    incompleteProblem: (params) => (params.asset === null ? "choose a model." : null),
  },
  "palette-from-image": {
    type: "palette-from-image",
    label: "Palette from Image",
    help: "Picks five colors from a picture.",
    final: false,
    inputs: [
      port("image", "picture", "The picture to take colors from.", "image", true, "Palette from Image needs a picture. Connect a Reference Image."),
    ],
    outputs: [port("palette", "palette", "Five colors for the game.", "palette")],
    defaultParams: () => ({}),
    shapeProblem: noParams,
    incompleteProblem: () => null,
  },
  "game-template": {
    type: "game-template",
    label: "Game Template",
    help: "A one-tap runner. Sets how fast it is, how high the hero jumps and how far apart the obstacles are.",
    final: false,
    inputs: [
      port("palette", "palette", "The game's colors. Without one, a sample palette is used.", "palette"),
      port("hero", "hero model", "The player's model. Without one, a built-in shape is used.", "model"),
      port("obstacle", "obstacle model", "The obstacles' model. Without one, a built-in shape is used.", "model"),
      port("collectible", "collectible model", "The collectibles' model. Without one, a built-in shape is used.", "model"),
    ],
    outputs: [port("settings", "game", "The finished game, ready to preview.", "settings")],
    defaultParams: () => ({ tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } }),
    shapeProblem: tuningParam,
    incompleteProblem: () => null,
  },
  preview: {
    type: "preview",
    label: "Preview",
    help: "Plays the game.",
    final: true,
    inputs: [port("settings", "game", "The game to play.", "settings", true, "Preview needs a game. Connect a Game Template.")],
    outputs: [],
    defaultParams: () => ({}),
    shapeProblem: noParams,
    incompleteProblem: () => null,
  },
};
