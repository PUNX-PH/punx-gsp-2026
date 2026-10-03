// The code behind each node type, by the id the registry gives it.
import { model } from "@/lib/graph/nodes/model";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { paletteFromImage } from "@/lib/graph/nodes/paletteFromImage";
import { referenceImage } from "@/lib/graph/nodes/referenceImage";
import type { Executor } from "@/lib/graph/types";

export const EXECUTORS: Record<string, Executor> = {
  "reference-image": referenceImage,
  model,
  "palette-from-image": paletteFromImage,
  "game-template": gameTemplate,
};
