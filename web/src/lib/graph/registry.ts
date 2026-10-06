// The closed list of node types: what each is called, what its ports carry, and how its settings are checked. Graphs
// name node types by id only, so nothing in a graph can add behavior. The plain names and one-line help are here so
// that every screen (and every error message) uses the same words.
import { SHAPES, TRIANGLES } from "@/lib/blender/types";
import { MODEL_KINDS } from "@/lib/builder/kinds";
import { ROLE_FILES, type WireType } from "@/lib/graph/types";
import { DENSITIES } from "@/lib/settings";

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
export const WIRE_WORDS: Record<WireType, string> = { image: "picture", model: "3D model", palette: "palette", feel: "feel", environment: "environment", settings: "game" };

const SHA256_HEX = /^[0-9a-f]{64}$/;

const hasExactly = (params: Record<string, unknown>, keys: string[]) =>
  Object.keys(params).length === keys.length && keys.every((k) => Object.hasOwn(params, k));

const noParams = (params: Record<string, unknown>) => (Object.keys(params).length === 0 ? null : "takes no settings.");

function fileParam(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["asset"])) return "asset is the only setting a file node has.";
  const { asset } = params;
  return asset === null || (typeof asset === "string" && SHA256_HEX.test(asset)) ? null : "asset must be an uploaded file, or nothing yet.";
}

export const MAX_PROMPT_CHARACTERS = 500;

function promptParam(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["prompt"])) return "prompt is the only setting a Describe Game step has.";
  const { prompt } = params;
  if (typeof prompt !== "string") return "prompt must be text.";
  return Array.from(prompt).length > MAX_PROMPT_CHARACTERS ? `the description is longer than ${MAX_PROMPT_CHARACTERS} characters.` : null;
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

const isSwatch = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;

function prepareParams(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["triangles", "color"])) return "triangles and color are the only settings a Prepare Model step has.";
  const { triangles, color } = params;
  if (typeof triangles !== "number" || !Number.isInteger(triangles) || triangles < TRIANGLES.min || triangles > TRIANGLES.max) {
    return `triangles must be a whole number from ${TRIANGLES.min} to ${TRIANGLES.max}.`;
  }
  return color === "original" || isSwatch(color) ? null : "color must be \"original\" or a swatch from 1 to 5.";
}

function shapeParams(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["shape", "color"])) return "shape and color are the only settings a Make Shape step has.";
  const { shape, color } = params;
  if (typeof shape !== "string" || !(SHAPES as readonly string[]).includes(shape)) {
    return `shape must be one of ${SHAPES.slice(0, -1).join(", ")} or ${SHAPES[SHAPES.length - 1]}.`;
  }
  return isSwatch(color) ? null : "color must be a swatch from 1 to 5.";
}

export const MAX_DESCRIPTION_CHARACTERS = 300;
export const MAX_MOTION_CHARACTERS = 200;

const MOTION_BOXES = [
  ["run", "Run"],
  ["jump", "Jump"],
  ["loop", "Loop"],
] as const;

function buildModelParams(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["role", "kind", "description", "run", "jump", "loop"])) {
    return "role, kind, description, run, jump and loop are the only settings a Build Model step has.";
  }
  const { role, kind, description } = params;
  if (typeof role !== "string" || !Object.hasOwn(ROLE_FILES, role)) return "role must be hero, obstacle or collectible.";
  if (typeof kind !== "string" || (kind !== "auto" && !(MODEL_KINDS as readonly string[]).includes(kind))) {
    return "kind must be auto, biped, vehicle, blob or prop.";
  }
  if (typeof description !== "string") return "description must be text.";
  if (Array.from(description).length > MAX_DESCRIPTION_CHARACTERS) return `the description is longer than ${MAX_DESCRIPTION_CHARACTERS} characters.`;
  for (const [key, name] of MOTION_BOXES) {
    const text = params[key];
    if (typeof text !== "string") return `${key} must be text.`;
    if (Array.from(text).length > MAX_MOTION_CHARACTERS) return `the ${name} box is longer than ${MAX_MOTION_CHARACTERS} characters.`;
  }
  return null;
}

export const MAX_THEME_CHARACTERS = 200;

function buildEnvironmentParams(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["theme", "density"])) return "theme and density are the only settings a Build Environment step has.";
  const { theme, density } = params;
  if (typeof theme !== "string") return "theme must be text.";
  if (Array.from(theme).length > MAX_THEME_CHARACTERS) return `the theme is longer than ${MAX_THEME_CHARACTERS} characters.`;
  return typeof density === "string" && (DENSITIES as readonly string[]).includes(density) ? null : "density must be few, some or lots.";
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
    help: "A model of your own, as a GLB, FBX or OBJ file.",
    final: false,
    inputs: [],
    outputs: [port("model", "3D model", "Your model.", "model")],
    defaultParams: () => ({ asset: null }),
    shapeProblem: fileParam,
    incompleteProblem: (params) => (params.asset === null ? "choose a model." : null),
  },
  "prepare-model": {
    type: "prepare-model",
    label: "Prepare Model",
    help: "Makes a model of yours game-ready: small, in flat colors.",
    final: false,
    inputs: [
      port("model", "3D model", "The model to prepare: a GLB, FBX or OBJ.", "model", true, "Prepare Model needs a model. Connect a 3D Model."),
      port("palette", "palette", "Colors to paint the model with. Without one, a sample palette is used.", "palette"),
    ],
    outputs: [port("model", "3D model", "The prepared model.", "model")],
    defaultParams: () => ({ triangles: TRIANGLES.default, color: "original" }),
    shapeProblem: prepareParams,
    incompleteProblem: () => null,
  },
  "make-shape": {
    type: "make-shape",
    label: "Make Shape",
    help: "Builds a simple low-poly shape.",
    final: false,
    inputs: [port("palette", "palette", "Colors to paint the shape with. Without one, a sample palette is used.", "palette")],
    outputs: [port("model", "3D model", "The shape.", "model")],
    defaultParams: () => ({ shape: "cube", color: 4 }),
    shapeProblem: shapeParams,
    incompleteProblem: () => null,
  },
  "build-model": {
    type: "build-model",
    label: "Build Model",
    help: "Builds a moving model from your words: a hero, an obstacle or a collectible.",
    final: false,
    inputs: [
      port("palette", "palette", "Colors to paint the model with. Without one, a sample palette is used.", "palette"),
      port("image", "picture", "A picture to take the look from. Optional.", "image"),
    ],
    outputs: [port("model", "3D model", "The model, with its motions.", "model")],
    defaultParams: () => ({ role: "hero", kind: "auto", description: "", run: "", jump: "", loop: "" }),
    shapeProblem: buildModelParams,
    incompleteProblem: (params) =>
      params.kind === "auto" && typeof params.description === "string" && params.description.trim() === "" ? "describe it first, or pick a kind." : null,
  },
  "build-environment": {
    type: "build-environment",
    label: "Build Environment",
    help: "Builds the world around the track from a theme.",
    final: false,
    inputs: [port("palette", "palette", "Colors for the world. Without one, a sample palette is used.", "palette")],
    outputs: [port("environment", "environment", "The sky, the field, the edge stripes and the scenery.", "environment")],
    defaultParams: () => ({ theme: "", density: "some" }),
    shapeProblem: buildEnvironmentParams,
    incompleteProblem: () => null,
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
  "describe-game": {
    type: "describe-game",
    label: "Describe Game",
    help: "Turns your words, and a picture if you give one, into the game's colors and feel.",
    final: false,
    inputs: [port("image", "picture", "A picture to take the look from. Optional.", "image")],
    outputs: [
      port("palette", "palette", "Five colors for the game.", "palette"),
      port("feel", "feel", "How fast, how high and how far apart.", "feel"),
    ],
    defaultParams: () => ({ prompt: "" }),
    shapeProblem: promptParam,
    incompleteProblem: (params) => (typeof params.prompt === "string" && params.prompt.trim() === "" ? "describe your game first." : null),
  },
  "game-template": {
    type: "game-template",
    label: "Game Template",
    help: "A one-tap runner. Sets how fast it is, how high the hero jumps and how far apart the obstacles are.",
    final: false,
    inputs: [
      port("palette", "palette", "The game's colors. Without one, a sample palette is used.", "palette"),
      port("feel", "feel", "How fast, how high and how far apart. Without one, the sliders below are used.", "feel"),
      port("environment", "environment", "The world around the track. Without one, the plain ground and sky are used.", "environment"),
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
