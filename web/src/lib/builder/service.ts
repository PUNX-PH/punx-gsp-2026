// The builder service: from what Build Model asks for to a stored, animated GLB. With every box empty and a kind chosen it needs no AI at
// all: the kit's default recipe and the role's default motions go to Blender. Words (a description or a motion box) are for the AI half,
// which is not wired here; without it they stop with the same plain sentence every AI step uses.
import { cleanPrompt } from "@/lib/ai/answer";
import type { BlenderService } from "@/lib/blender/types";
import { CLIPS_FOR_ROLE } from "@/lib/builder/kinds";
import { defaultMotions, defaultRecipe } from "@/lib/builder/recipes";
import type { BuilderService } from "@/lib/builder/types";
import { NodeError } from "@/lib/graph/types";

export interface BuilderDeps {
  blender: BlenderService;
  now: () => number;
  /** Where outcomes are logged: numbers and codes only, never the person's words or a recipe. */
  log?: (info: object) => void;
}

export function makeBuilderService(deps: BuilderDeps): BuilderService {
  return {
    async buildModel(job, input) {
      const description = cleanPrompt(input.description);
      // Only the boxes of this role's own clips count: a Loop box left behind on a hero is not a motion it has.
      const boxes = CLIPS_FOR_ROLE[input.role].map((clip) => cleanPrompt(input.motions[clip]));
      const wordsGiven = description !== "" || boxes.some((box) => box !== "");

      if (input.kind === "auto" && description === "") throw new NodeError("Build Model: describe it first, or pick a kind.");
      if (wordsGiven) throw new NodeError("Build Model: The AI service did not answer. Try again.");

      // Auto with an empty description was refused above, so a kind is chosen here.
      const kind = input.kind === "auto" ? "biped" : input.kind;
      const recipe = defaultRecipe(kind);
      const motions = defaultMotions(recipe, CLIPS_FOR_ROLE[input.role]);
      const built = await deps.blender.build(job, { label: "Build Model", body: { recipe, motions, palette: [...input.palette] } });
      return {
        sha256: built.sha256,
        size: built.size,
        kind,
        parts: built.parts,
        triangles: built.triangles,
        clips: built.clips,
        summary: recipe.summary,
        skipped: [],
        reused: built.reused,
      };
    },
  };
}
