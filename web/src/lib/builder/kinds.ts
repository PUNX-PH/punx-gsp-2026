// The kit: everything a recipe may be made of, in one place. The same data lives once in blender-worker/scripts/kit.json, which the worker's
// recipe check and build.py read; the KIT literal below is a typed copy of it, and a test keeps the two equal. Names and ranges here are the
// ones the spec lists. Colors in recipes are palette slots 0 to 4, never hex.
import type { Role } from "@/lib/graph/types";

export const MODEL_KINDS = ["biped", "vehicle", "blob", "prop"] as const;
export type ModelKind = (typeof MODEL_KINDS)[number];
export const KIND_NAMES: Record<ModelKind, string> = {
  biped: "Two-legged character",
  vehicle: "Wheeled vehicle",
  blob: "Bouncy blob",
  prop: "Simple prop",
};

export const EXTRAS = ["tail", "ears", "antenna", "hat", "backpack"] as const;
export type Extra = (typeof EXTRAS)[number];

export const SCENERY_KINDS = ["tree", "pine", "rock", "cactus", "windmill", "lamp"] as const;
export type SceneryKind = (typeof SCENERY_KINDS)[number];
export const SCENERY_NAMES: Record<SceneryKind, string> = {
  tree: "Tree",
  pine: "Pine",
  rock: "Rock",
  cactus: "Cactus",
  windmill: "Windmill",
  lamp: "Lamp",
};

/** An environment has at most this many pieces of scenery. */
export const MAX_SCENERY = 3;

/** The seven Make Shape shapes plus two of ours. */
export const PROP_SHAPES = ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring", "gem", "crate"] as const;
export type PropShape = (typeof PROP_SHAPES)[number];

export const CLIP_KEYS = ["run", "jump", "loop"] as const;
export type ClipKey = (typeof CLIP_KEYS)[number];
export type ClipName = "Run" | "Jump" | "Loop";
export const CLIP_NAMES: Record<ClipKey, ClipName> = { run: "Run", jump: "Jump", loop: "Loop" };
/** A hero runs and jumps; an obstacle or a collectible loops. */
export const CLIPS_FOR_ROLE: Record<Role, ClipKey[]> = { hero: ["run", "jump"], obstacle: ["loop"], collectible: ["loop"] };

export const CHANNELS = ["rotate", "move", "scale"] as const;
export type Channel = (typeof CHANNELS)[number];
export const AXES = ["x", "y", "z"] as const;
export type Axis = (typeof AXES)[number];
export const WAVES = ["swing", "spin", "bounce", "pulse", "hold"] as const;
export type Wave = (typeof WAVES)[number];

/** Standard is the default and the phone-safe tier; High is lit and detailed, inside hard budgets (see the kit's tiers). */
export const QUALITIES = ["standard", "high"] as const;
export type Quality = (typeof QUALITIES)[number];

/** What a color slot is made of: a finish is a metallic, roughness and emission setting, so metal and glow cost no triangles. */
export const FINISHES = ["matte", "painted", "metal", "rubber", "glow"] as const;
export type Finish = (typeof FINISHES)[number];

/** Extra detail a High model can have, each priced in triangles. Dropped in this order when over budget: cables, bolts, seams, lights. */
export const DETAILS = ["seams", "bolts", "cables", "lights"] as const;
export type Detail = (typeof DETAILS)[number];
export const DROP_ORDER: readonly Detail[] = ["cables", "bolts", "seams", "lights"];

export const WORLD_PIECES = ["terrain", "road", "backdrop"] as const;
export type WorldPiece = (typeof WORLD_PIECES)[number];
export const WORLD_STYLES = ["desert", "meadow"] as const;
export type WorldStyle = (typeof WORLD_STYLES)[number];

export interface NumberField {
  min: number;
  max: number;
  default: number;
  whole?: true;
}
export interface ChoiceField {
  choices: readonly string[];
  default: string;
}
export type BuildField = NumberField | ChoiceField;

export interface TrackSpec {
  joint: string;
  channel: Channel;
  axis: Axis;
  wave: Wave;
  amplitude: number;
  cycles: number;
  phase: number;
}
export interface MotionSpec {
  seconds: number;
  tracks: TrackSpec[];
}
export interface Counts {
  parts: number;
  triangles: number;
}
export interface KindCounts extends Partial<Counts> {
  cab?: Counts;
  wheel?: Counts;
  shapes?: Record<PropShape, Counts>;
}
export interface KindSpec {
  summary: string;
  build: Record<string, BuildField>;
  slots: Record<string, number>;
  /** [name, parent], parents first; a null parent is the root. */
  joints: [string, string | null][];
  /** Named places an extra can attach to: `@back`, `@top`, `@chest` resolve here. */
  anchors: Record<string, string>;
  extras: Extra[];
  count: KindCounts;
  motions: Record<ClipKey, MotionSpec>;
}
export interface ExtraSpec extends Counts {
  /** [name, parent]; a parent starting with `@` is an anchor of the kind. */
  joints: [string, string][];
}
export interface SceneryKit {
  /** [name, parent], parents first; the first is the root. */
  joints: [string, string | null][];
  slots: Record<string, number>;
  /** How tall the piece is built, in meters. The game keeps this size. */
  height: number;
  count: Counts;
  /** The Loop of an animated piece, or null for one that stands still. */
  loop: MotionSpec | null;
}
/** Triangles, shared vertices, parts and meshes: what a High model may use, or what a piece of it costs. */
export interface Budget {
  triangles: number;
  vertices: number;
  parts: number;
  meshes: number;
}
export interface FinishValues {
  metallic: number;
  roughness: number;
  emission: number;
}
export interface TierDefaults {
  finishes: Record<string, Finish>;
  details: Detail[];
}
export interface HighTier {
  caps: Record<ModelKind | "scenery", Budget> & {
    world: Record<WorldPiece, { triangles: number; vertices: number }>;
    materials: number;
    details: number;
  };
  finishes: Record<Finish, FinishValues>;
  /** What each extra adds in High. */
  extras: Record<Extra, Budget>;
  /** What each detail adds, per kind that can have it; a kind with no entry cannot have that detail. */
  details: Record<Detail, Partial<Record<ModelKind, Budget>>>;
  defaults: {
    biped: TierDefaults;
    vehicle: TierDefaults;
    blob: TierDefaults;
    prop: TierDefaults;
    scenery: Record<SceneryKind, { finishes: Record<string, Finish> }>;
    world: { finishes: Record<string, Finish> };
  };
  /** The High model of each kind before extras and details (a vehicle adds its cab and wheels, a prop is its shape). */
  base: {
    biped: Budget;
    vehicle: Budget & { cab: Budget; wheel: Budget };
    blob: Budget;
    prop: { shapes: Record<PropShape, Budget> };
    scenery: Record<SceneryKind, Budget>;
    world: Record<WorldPiece, { triangles: number; vertices: number }>;
  };
  /** The palette slots a world piece is colored with (ground, accent, far), and the styles. */
  worlds: { pieces: WorldPiece[]; slots: Record<string, number>; styles: WorldStyle[] };
}

export interface Kit {
  version: 1;
  caps: { parts: number; triangles: number; sceneryTriangles: number; extras: number; tracks: number; summary: number };
  motion: {
    fps: number;
    seconds: [number, number];
    cycles: [number, number];
    phase: [number, number];
    amplitude: Record<Channel, [number, number]>;
  };
  /** The freeform kind (a list of parts): its caps, and the triangle budget of each role for each target. */
  freeform: {
    caps: { parts: number; points: number; profile: number; sections: number; materials: number; extent: number };
    budgets: Record<"hero" | "prop" | "scenery", Record<"pc" | "mobile", number>>;
  };
  kinds: Record<ModelKind, KindSpec>;
  extras: Record<Extra, ExtraSpec>;
  scenery: Record<SceneryKind, SceneryKit>;
  tiers: { high: HighTier };
}

export const KIT: Kit = {
  "version": 1,
  "caps": { "parts": 24, "triangles": 2000, "sceneryTriangles": 600, "extras": 2, "tracks": 12, "summary": 140 },
  "motion": {
    "fps": 24,
    "seconds": [0.3, 3],
    "cycles": [0.5, 4],
    "phase": [0, 1],
    "amplitude": { "rotate": [-90, 90], "move": [-0.5, 0.5], "scale": [-0.5, 0.5] }
  },
  "freeform": {
    "caps": { "parts": 48, "points": 10, "profile": 14, "sections": 10, "materials": 6, "extent": 12 },
    "budgets": { "hero": { "pc": 15000, "mobile": 5000 }, "prop": { "pc": 5000, "mobile": 1500 }, "scenery": { "pc": 8000, "mobile": 2500 } }
  },
  "kinds": {
    "biped": {
      "summary": "A blocky two-legged character.",
      "build": {
        "headSize": { "min": 0.3, "max": 0.8, "default": 0.5 },
        "torsoWidth": { "min": 0.3, "max": 0.9, "default": 0.5 },
        "torsoHeight": { "min": 0.3, "max": 0.9, "default": 0.55 },
        "armLength": { "min": 0.3, "max": 0.8, "default": 0.5 },
        "armThickness": { "min": 0.08, "max": 0.25, "default": 0.14 },
        "legLength": { "min": 0.3, "max": 0.9, "default": 0.5 },
        "legThickness": { "min": 0.1, "max": 0.3, "default": 0.17 },
        "footSize": { "min": 0.1, "max": 0.35, "default": 0.2 }
      },
      "slots": { "head": 4, "body": 3, "arms": 3, "legs": 2, "feet": 0, "extra": 1 },
      "joints": [
        ["hips", null],
        ["spine", "hips"],
        ["chest", "spine"],
        ["neck", "chest"],
        ["head", "neck"],
        ["upperarm_l", "chest"],
        ["forearm_l", "upperarm_l"],
        ["hand_l", "forearm_l"],
        ["upperarm_r", "chest"],
        ["forearm_r", "upperarm_r"],
        ["hand_r", "forearm_r"],
        ["thigh_l", "hips"],
        ["shin_l", "thigh_l"],
        ["foot_l", "shin_l"],
        ["thigh_r", "hips"],
        ["shin_r", "thigh_r"],
        ["foot_r", "shin_r"]
      ],
      "anchors": { "back": "hips", "top": "head", "chest": "chest" },
      "extras": ["tail", "ears", "antenna", "hat", "backpack"],
      "count": { "parts": 15, "triangles": 180 },
      "motions": {
        "run": {
          "seconds": 0.6,
          "tracks": [
            {
              "joint": "thigh_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 35,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "thigh_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 35,
              "cycles": 1,
              "phase": 0.5
            },
            {
              "joint": "shin_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "bounce",
              "amplitude": 40,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "shin_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "bounce",
              "amplitude": 40,
              "cycles": 1,
              "phase": 0.5
            },
            {
              "joint": "upperarm_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 30,
              "cycles": 1,
              "phase": 0.5
            },
            {
              "joint": "upperarm_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 30,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "hips",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.04,
              "cycles": 2,
              "phase": 0
            }
          ]
        },
        "jump": {
          "seconds": 0.8,
          "tracks": [
            {
              "joint": "thigh_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": -40,
              "cycles": 0.5,
              "phase": 0
            },
            {
              "joint": "thigh_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": -40,
              "cycles": 0.5,
              "phase": 0
            },
            {
              "joint": "shin_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 60,
              "cycles": 0.5,
              "phase": 0
            },
            {
              "joint": "shin_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": 60,
              "cycles": 0.5,
              "phase": 0
            },
            {
              "joint": "upperarm_l",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": -80,
              "cycles": 0.5,
              "phase": 0
            },
            {
              "joint": "upperarm_r",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": -80,
              "cycles": 0.5,
              "phase": 0
            }
          ]
        },
        "loop": {
          "seconds": 1.2,
          "tracks": [
            {
              "joint": "upperarm_r",
              "channel": "rotate",
              "axis": "z",
              "wave": "swing",
              "amplitude": 30,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "head",
              "channel": "rotate",
              "axis": "y",
              "wave": "swing",
              "amplitude": 15,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "hips",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.03,
              "cycles": 2,
              "phase": 0
            }
          ]
        }
      }
    },
    "vehicle": {
      "summary": "A blocky little vehicle.",
      "build": {
        "bodyLength": { "min": 0.8, "max": 2.5, "default": 1.6 },
        "bodyWidth": { "min": 0.5, "max": 1.5, "default": 0.9 },
        "bodyHeight": { "min": 0.3, "max": 1, "default": 0.45 },
        "cabSize": { "min": 0, "max": 0.8, "default": 0.45 },
        "wheelCount": { "min": 2, "max": 6, "default": 4, "whole": true },
        "wheelRadius": { "min": 0.15, "max": 0.5, "default": 0.25 }
      },
      "slots": { "body": 3, "cab": 4, "wheels": 0, "extra": 1 },
      "joints": [["body", null]],
      "anchors": { "back": "body", "top": "body", "chest": "body" },
      "extras": ["antenna"],
      "count": {
        "parts": 1,
        "triangles": 12,
        "cab": { "parts": 1, "triangles": 12 },
        "wheel": { "parts": 1, "triangles": 28 }
      },
      "motions": {
        "run": {
          "seconds": 0.5,
          "tracks": [
            {
              "joint": "wheel_1",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_2",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_3",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_4",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_5",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_6",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "body",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.02,
              "cycles": 2,
              "phase": 0
            }
          ]
        },
        "jump": {
          "seconds": 0.8,
          "tracks": [
            {
              "joint": "body",
              "channel": "rotate",
              "axis": "x",
              "wave": "swing",
              "amplitude": -10,
              "cycles": 0.5,
              "phase": 0
            }
          ]
        },
        "loop": {
          "seconds": 1,
          "tracks": [
            {
              "joint": "wheel_1",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_2",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_3",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_4",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_5",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "wheel_6",
              "channel": "rotate",
              "axis": "x",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "body",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.03,
              "cycles": 2,
              "phase": 0
            }
          ]
        }
      }
    },
    "blob": {
      "summary": "A bouncy blob with two eyes.",
      "build": {
        "radius": { "min": 0.3, "max": 1, "default": 0.5 },
        "squash": { "min": 0.5, "max": 1.5, "default": 0.85 },
        "eyeSize": { "min": 0.05, "max": 0.3, "default": 0.12 }
      },
      "slots": { "body": 3, "eyes": 4, "extra": 1 },
      "joints": [["body", null], ["eye_l", "body"], ["eye_r", "body"]],
      "anchors": { "back": "body", "top": "body", "chest": "body" },
      "extras": ["tail", "ears", "antenna", "hat"],
      "count": { "parts": 3, "triangles": 104 },
      "motions": {
        "run": {
          "seconds": 0.5,
          "tracks": [
            {
              "joint": "body",
              "channel": "scale",
              "axis": "y",
              "wave": "pulse",
              "amplitude": -0.2,
              "cycles": 2,
              "phase": 0
            },
            {
              "joint": "body",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.08,
              "cycles": 2,
              "phase": 0
            }
          ]
        },
        "jump": {
          "seconds": 0.8,
          "tracks": [
            {
              "joint": "body",
              "channel": "scale",
              "axis": "y",
              "wave": "swing",
              "amplitude": 0.25,
              "cycles": 0.5,
              "phase": 0
            }
          ]
        },
        "loop": {
          "seconds": 1,
          "tracks": [
            {
              "joint": "body",
              "channel": "move",
              "axis": "y",
              "wave": "bounce",
              "amplitude": 0.12,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "body",
              "channel": "scale",
              "axis": "y",
              "wave": "pulse",
              "amplitude": -0.15,
              "cycles": 1,
              "phase": 0
            }
          ]
        }
      }
    },
    "prop": {
      "summary": "A simple spinning prop.",
      "build": {
        "shape": {
          "choices": ["cube", "sphere", "cone", "cylinder", "pyramid", "coin", "ring", "gem", "crate"],
          "default": "gem"
        },
        "size": { "min": 0.3, "max": 1.5, "default": 1 }
      },
      "slots": { "body": 3, "extra": 4 },
      "joints": [["root", null]],
      "anchors": {},
      "extras": [],
      "count": {
        "shapes": {
          "cube": { "parts": 1, "triangles": 12 },
          "sphere": { "parts": 1, "triangles": 80 },
          "cone": { "parts": 1, "triangles": 14 },
          "cylinder": { "parts": 1, "triangles": 28 },
          "pyramid": { "parts": 1, "triangles": 6 },
          "coin": { "parts": 1, "triangles": 44 },
          "ring": { "parts": 1, "triangles": 144 },
          "gem": { "parts": 1, "triangles": 12 },
          "crate": { "parts": 3, "triangles": 36 }
        }
      },
      "motions": {
        "run": {
          "seconds": 1,
          "tracks": [
            {
              "joint": "root",
              "channel": "rotate",
              "axis": "y",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            }
          ]
        },
        "jump": {
          "seconds": 0.8,
          "tracks": [
            {
              "joint": "root",
              "channel": "rotate",
              "axis": "y",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            }
          ]
        },
        "loop": {
          "seconds": 1,
          "tracks": [
            {
              "joint": "root",
              "channel": "rotate",
              "axis": "y",
              "wave": "spin",
              "amplitude": 1,
              "cycles": 1,
              "phase": 0
            },
            {
              "joint": "root",
              "channel": "move",
              "axis": "y",
              "wave": "swing",
              "amplitude": 0.1,
              "cycles": 1,
              "phase": 0
            }
          ]
        }
      }
    }
  },
  "extras": {
    "tail": { "joints": [["tail_1", "@back"], ["tail_2", "tail_1"]], "parts": 2, "triangles": 24 },
    "ears": { "joints": [["ear_l", "@top"], ["ear_r", "@top"]], "parts": 2, "triangles": 24 },
    "antenna": { "joints": [["antenna", "@top"]], "parts": 2, "triangles": 40 },
    "hat": { "joints": [["hat", "@top"]], "parts": 1, "triangles": 28 },
    "backpack": { "joints": [["backpack", "@chest"]], "parts": 1, "triangles": 12 }
  },
  "scenery": {
    "tree": {
      "joints": [["root", null], ["canopy", "root"]],
      "slots": { "main": 1, "detail": 2 },
      "height": 3.5,
      "count": { "parts": 3, "triangles": 188 },
      "loop": {
        "seconds": 2.4,
        "tracks": [
          { "joint": "canopy", "channel": "rotate", "axis": "x", "wave": "swing", "amplitude": 4, "cycles": 1, "phase": 0 },
          { "joint": "canopy", "channel": "rotate", "axis": "z", "wave": "swing", "amplitude": 3, "cycles": 1, "phase": 0.25 }
        ]
      }
    },
    "pine": {
      "joints": [["root", null], ["canopy", "root"]],
      "slots": { "main": 1, "detail": 2 },
      "height": 4.5,
      "count": { "parts": 4, "triangles": 70 },
      "loop": {
        "seconds": 2.8,
        "tracks": [
          { "joint": "canopy", "channel": "rotate", "axis": "x", "wave": "swing", "amplitude": 3, "cycles": 1, "phase": 0 }
        ]
      }
    },
    "rock": {
      "joints": [["root", null]],
      "slots": { "main": 2, "detail": 2 },
      "height": 1.2,
      "count": { "parts": 2, "triangles": 40 },
      "loop": null
    },
    "cactus": {
      "joints": [["root", null]],
      "slots": { "main": 1, "detail": 2 },
      "height": 2.2,
      "count": { "parts": 6, "triangles": 88 },
      "loop": null
    },
    "windmill": {
      "joints": [["root", null], ["blades", "root"]],
      "slots": { "main": 4, "detail": 1 },
      "height": 6,
      "count": { "parts": 7, "triangles": 102 },
      "loop": {
        "seconds": 2,
        "tracks": [
          { "joint": "blades", "channel": "rotate", "axis": "z", "wave": "spin", "amplitude": 1, "cycles": 1, "phase": 0 }
        ]
      }
    },
    "lamp": {
      "joints": [["root", null]],
      "slots": { "main": 2, "detail": 4 },
      "height": 3.2,
      "count": { "parts": 3, "triangles": 68 },
      "loop": null
    }
  },
  "tiers": {
    "high": {
      "caps": {
        "biped": { "triangles": 12000, "vertices": 9500, "parts": 80, "meshes": 14 },
        "vehicle": { "triangles": 6000, "vertices": 4800, "parts": 50, "meshes": 10 },
        "blob": { "triangles": 5000, "vertices": 4000, "parts": 30, "meshes": 6 },
        "prop": { "triangles": 3500, "vertices": 2800, "parts": 24, "meshes": 5 },
        "scenery": { "triangles": 1500, "vertices": 1200, "parts": 24, "meshes": 3 },
        "world": {
          "terrain": { "triangles": 8000, "vertices": 4200 },
          "road": { "triangles": 1500, "vertices": 1200 },
          "backdrop": { "triangles": 1200, "vertices": 700 }
        },
        "materials": 7,
        "details": 4
      },
      "finishes": {
        "matte": { "metallic": 0, "roughness": 0.85, "emission": 0 },
        "painted": { "metallic": 0, "roughness": 0.35, "emission": 0 },
        "metal": { "metallic": 0.9, "roughness": 0.3, "emission": 0 },
        "rubber": { "metallic": 0, "roughness": 0.9, "emission": 0 },
        "glow": { "metallic": 0, "roughness": 0.5, "emission": 1 }
      },
      "extras": {
        "tail": { "triangles": 360, "vertices": 184, "parts": 2, "meshes": 0 },
        "ears": { "triangles": 360, "vertices": 184, "parts": 2, "meshes": 0 },
        "antenna": { "triangles": 516, "vertices": 358, "parts": 3, "meshes": 0 },
        "hat": { "triangles": 140, "vertices": 72, "parts": 1, "meshes": 0 },
        "backpack": { "triangles": 432, "vertices": 384, "parts": 4, "meshes": 0 }
      },
      "details": {
        "seams": {
          "biped": { "triangles": 228, "vertices": 264, "parts": 4, "meshes": 0 },
          "vehicle": { "triangles": 36, "vertices": 72, "parts": 3, "meshes": 0 },
          "blob": { "triangles": 384, "vertices": 352, "parts": 2, "meshes": 0 },
          "prop": { "triangles": 432, "vertices": 468, "parts": 3, "meshes": 0 }
        },
        "bolts": {
          "biped": { "triangles": 392, "vertices": 448, "parts": 14, "meshes": 0 },
          "vehicle": { "triangles": 224, "vertices": 256, "parts": 8, "meshes": 0 },
          "prop": { "triangles": 224, "vertices": 256, "parts": 8, "meshes": 0 }
        },
        "cables": {
          "biped": { "triangles": 288, "vertices": 336, "parts": 4, "meshes": 0 },
          "vehicle": { "triangles": 144, "vertices": 168, "parts": 2, "meshes": 0 }
        },
        "lights": {
          "biped": { "triangles": 72, "vertices": 144, "parts": 6, "meshes": 0 },
          "vehicle": { "triangles": 312, "vertices": 204, "parts": 4, "meshes": 0 },
          "blob": { "triangles": 288, "vertices": 156, "parts": 2, "meshes": 0 }
        }
      },
      "defaults": {
        "biped": {
          "finishes": { "head": "painted", "body": "painted", "arms": "painted", "legs": "metal", "feet": "rubber", "extra": "painted" },
          "details": ["seams", "bolts", "lights"]
        },
        "vehicle": {
          "finishes": { "body": "painted", "cab": "metal", "wheels": "rubber", "extra": "painted" },
          "details": ["seams", "lights"]
        },
        "blob": {
          "finishes": { "body": "painted", "eyes": "glow", "extra": "matte" },
          "details": ["lights"]
        },
        "prop": {
          "finishes": { "body": "painted", "extra": "metal" },
          "details": ["seams", "bolts"]
        },
        "scenery": {
          "tree": {
            "finishes": { "main": "matte", "detail": "matte" }
          },
          "pine": {
            "finishes": { "main": "matte", "detail": "matte" }
          },
          "rock": {
            "finishes": { "main": "matte", "detail": "matte" }
          },
          "cactus": {
            "finishes": { "main": "matte", "detail": "glow" }
          },
          "windmill": {
            "finishes": { "main": "painted", "detail": "painted" }
          },
          "lamp": {
            "finishes": { "main": "metal", "detail": "glow" }
          }
        },
        "world": {
          "finishes": { "ground": "matte", "accent": "matte", "far": "matte" }
        }
      },
      "base": {
        "biped": { "triangles": 7188, "vertices": 4788, "parts": 52, "meshes": 7 },
        "vehicle": {
          "triangles": 432,
          "vertices": 384,
          "parts": 4,
          "meshes": 1,
          "cab": { "triangles": 120, "vertices": 120, "parts": 2, "meshes": 0 },
          "wheel": { "triangles": 160, "vertices": 104, "parts": 2, "meshes": 1 }
        },
        "blob": { "triangles": 1488, "vertices": 1038, "parts": 6, "meshes": 1 },
        "prop": {
          "shapes": {
            "cube": { "triangles": 108, "vertices": 96, "parts": 1, "meshes": 1 },
            "sphere": { "triangles": 440, "vertices": 222, "parts": 1, "meshes": 1 },
            "cone": { "triangles": 94, "vertices": 97, "parts": 1, "meshes": 1 },
            "cylinder": { "triangles": 156, "vertices": 80, "parts": 1, "meshes": 1 },
            "pyramid": { "triangles": 14, "vertices": 32, "parts": 1, "meshes": 1 },
            "coin": { "triangles": 476, "vertices": 384, "parts": 2, "meshes": 1 },
            "ring": { "triangles": 480, "vertices": 240, "parts": 1, "meshes": 1 },
            "gem": { "triangles": 70, "vertices": 81, "parts": 3, "meshes": 1 },
            "crate": { "triangles": 324, "vertices": 288, "parts": 3, "meshes": 1 }
          }
        },
        "scenery": {
          "tree": { "triangles": 804, "vertices": 430, "parts": 4, "meshes": 2 },
          "pine": { "triangles": 174, "vertices": 193, "parts": 6, "meshes": 2 },
          "rock": { "triangles": 336, "vertices": 174, "parts": 2, "meshes": 1 },
          "cactus": { "triangles": 1068, "vertices": 596, "parts": 7, "meshes": 1 },
          "windmill": { "triangles": 834, "vertices": 723, "parts": 8, "meshes": 2 },
          "lamp": { "triangles": 532, "vertices": 422, "parts": 5, "meshes": 1 }
        },
        "world": {
          "terrain": { "triangles": 8000, "vertices": 4131 },
          "road": { "triangles": 868, "vertices": 595 },
          "backdrop": { "triangles": 408, "vertices": 612 }
        }
      },
      "worlds": {
        "pieces": ["terrain", "road", "backdrop"],
        "slots": { "ground": 3, "accent": 2, "far": 1 },
        "styles": ["desert", "meadow"]
      }
    }
  }
};

/** The metallic, roughness and emission of each finish. */
export const FINISH_VALUES: Record<Finish, FinishValues> = KIT.tiers.high.finishes;

/** What a model or scenery piece of this kind may use in this tier. Standard has no vertex or mesh limit: those are infinite here. */
export function tierCaps(kind: ModelKind | "scenery", quality: Quality): Budget {
  if (quality === "high") return KIT.tiers.high.caps[kind];
  return {
    triangles: kind === "scenery" ? KIT.caps.sceneryTriangles : KIT.caps.triangles,
    vertices: Number.POSITIVE_INFINITY,
    parts: KIT.caps.parts,
    meshes: Number.POSITIVE_INFINITY,
  };
}
