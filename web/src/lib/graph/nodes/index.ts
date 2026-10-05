// The code behind each node type, by the id the registry gives it.
import { buildModel } from "@/lib/graph/nodes/buildModel";
import { describeGame } from "@/lib/graph/nodes/describeGame";
import { makeShape } from "@/lib/graph/nodes/makeShape";
import { model } from "@/lib/graph/nodes/model";
import { gameTemplate } from "@/lib/graph/nodes/gameTemplate";
import { paletteFromImage } from "@/lib/graph/nodes/paletteFromImage";
import { prepareModel } from "@/lib/graph/nodes/prepareModel";
import { preview } from "@/lib/graph/nodes/preview";
import { referenceImage } from "@/lib/graph/nodes/referenceImage";
import type { Executor } from "@/lib/graph/types";

export const EXECUTORS: Record<string, Executor> = {
  "reference-image": referenceImage,
  model,
  "prepare-model": prepareModel,
  "make-shape": makeShape,
  "build-model": buildModel,
  "palette-from-image": paletteFromImage,
  "describe-game": describeGame,
  "game-template": gameTemplate,
  preview,
};
