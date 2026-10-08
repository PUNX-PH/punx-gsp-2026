// The closed list of node types: what each is called, what its ports carry, and how its settings are checked. Graphs
// name node types by id only, so nothing in a graph can add behavior. The plain names and one-line help are here so
// that every screen (and every error message) uses the same words.
import { SHAPES, TRIANGLES } from "@/lib/blender/types";
import { MODEL_KINDS, QUALITIES } from "@/lib/builder/kinds";
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
export const WIRE_WORDS: Record<WireType, string> = { image: "picture", model: "3D model", palette: "palette", feel: "feel", environment: "environment", settings: "game", game: "game" };

const SHA256_HEX = /^[0-9a-f]{64}$/;

const hasExactly = (params: Record<string, unknown>, keys: string[]) =>
  Object.keys(params).length === keys.length && keys.every((k) => Object.hasOwn(params, k));

/** Whether the settings have these keys, and perhaps `quality` too: a graph saved before the Quality setting has none, and means Standard. */
const hasExactlyAndMaybeQuality = (params: Record<string, unknown>, keys: string[]) => {
  const rest = { ...params };
  delete rest.quality;
  return hasExactly(rest, keys);
};

const QUALITY_PROBLEM = "the quality must be standard or high.";
const qualityProblem = (params: Record<string, unknown>): string | null =>
  !Object.hasOwn(params, "quality") || (typeof params.quality === "string" && (QUALITIES as readonly string[]).includes(params.quality)) ? null : QUALITY_PROBLEM;

const noParams = (params: Record<string, unknown>) => (Object.keys(params).length === 0 ? null : "takes no settings.");

function fileParam(params: Record<string, unknown>): string | null {
  if (!hasExactly(params, ["asset"])) return "asset is the only setting a file node has.";
  const { asset } = params;
  return asset === null || (typeof asset === "string" && SHA256_HEX.test(asset)) ? null : "asset must be an uploaded file, or nothing yet.";
}

export const MAX_PROMPT_CHARACTERS = 500;

/** What Describe Game makes: a Lua script, a game of rules for the engine, or only the colors and the feel. */
export type MakeGameMode = "script" | "rules" | "off";
const MAKE_GAME_MODES: readonly string[] = ["script", "rules", "off"];
const MAX_ATTEMPTS = 1_000;

/** A saved `makeGame` as a mode: the words as they are, a saved true (from before scripts) is rules, and false or nothing is off. */
export function makeGameMode(value: unknown): MakeGameMode {
  if (value === true) return "rules";
  return typeof value === "string" && MAKE_GAME_MODES.includes(value) ? (value as MakeGameMode) : "off";
}

function promptParam(params: Record<string, unknown>): string | null {
  // `makeGame` and `attempt` are optional: a graph saved before Describe Game could write a whole game has only the prompt. `makeGame` is a switch
  // (true for rules, false for off) in graphs saved before scripts, and one of the three words after; `attempt` counts presses of Try again.
  const rest = { ...params };
  delete rest.makeGame;
  delete rest.attempt;
  if (!hasExactly(rest, ["prompt"])) return "prompt, makeGame and attempt are the only settings a Describe Game step has.";
  if (Object.hasOwn(params, "makeGame") && typeof params.makeGame !== "boolean" && !(typeof params.makeGame === "string" && MAKE_GAME_MODES.includes(params.makeGame))) {
    return "make a game must be script, rules or off.";
  }
  if (Object.hasOwn(params, "attempt") && !(Number.isInteger(params.attempt) && (params.attempt as number) >= 0 && (params.attempt as number) <= MAX_ATTEMPTS)) {
    return `attempt must be a whole number from 0 to ${MAX_ATTEMPTS}.`;
  }
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
  // `soft` is optional and true only for a step the site made from a described game: if it fails, the game goes on and the model is a plain shape.
  const { soft, ...rest } = params;
  if (Object.hasOwn(params, "soft") && typeof soft !== "boolean") return "soft must be on or off.";
  if (!hasExactlyAndMaybeQuality(rest, ["role", "kind", "description", "run", "jump", "loop"])) {
    return "role, kind, description, run, jump, loop, quality and soft are the only settings a Build Model step has.";
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
  return qualityProblem(params);
}

export const MAX_THEME_CHARACTERS = 200;

function buildEnvironmentParams(params: Record<string, unknown>): string | null {
  if (!hasExactlyAndMaybeQuality(params, ["theme", "density"])) return "theme, density and quality are the only settings a Build Environment step has.";
  const { theme, density } = params;
  if (typeof theme !== "string") return "theme must be text.";
  if (Array.from(theme).length > MAX_THEME_CHARACTERS) return `the theme is longer than ${MAX_THEME_CHARACTERS} characters.`;
  if (typeof density !== "string" || !(DENSITIES as readonly string[]).includes(density)) return "density must be few, some or lots.";
  return qualityProblem(params);
}

const port = (name: string, label: string, help: string, type: WireType, required = false, missing?: string): PortSpec => ({
  name,
  label,
  help,
  type,
  required,
  ...(missing ? { missing } : {}),
});

/** How many numbered model inputs a script game has: its first, second and so on model, in the order Describe Game lists them. */
export const SCRIPT_MODEL_PORTS = 6;
const MODEL_PORTS: PortSpec[] = Array.from({ length: SCRIPT_MODEL_PORTS }, (_, i) =>
  port(`model${i + 1}`, `model ${i + 1}`, `The game's model number ${i + 1}, in the order Describe Game lists them. Without one, a plain shape is used.`, "model"),
);

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
    defaultParams: () => ({ role: "hero", kind: "auto", description: "", run: "", jump: "", loop: "", quality: "standard" }),
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
    defaultParams: () => ({ theme: "", density: "some", quality: "standard" }),
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
    help: "Turns your words, and a picture if you give one, into a game: what moves, what the player does and how it ends. With Make a game off, only the colors and feel.",
    final: false,
    inputs: [port("image", "picture", "A picture to take the look from. Optional.", "image")],
    outputs: [
      port("palette", "palette", "Five colors for the game.", "palette"),
      port("feel", "feel", "How fast, how high and how far apart. Not made with Make a game on.", "feel"),
      port("game", "game rules", "The whole game, when Make a game is on.", "game"),
    ],
    defaultParams: () => ({ prompt: "", makeGame: "script" }),
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
      port("game", "game rules", "A whole game from Describe Game. Without one, the runner below is made.", "game"),
      ...MODEL_PORTS,
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
