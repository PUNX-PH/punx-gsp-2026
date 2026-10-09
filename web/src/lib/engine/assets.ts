// The assets of a game: for each entity Claude asked art for, a model built by the slice 6 builder (Claude writes the recipe, Blender builds it, both
// cached and counted as for Build Model). One entity's failure never fails the game: that entity is drawn as a plain shape. The builder shapes every
// call to Play's clock, and no new build is started when too little time is left.
import type { BuilderService } from "@/lib/builder/types";
import type { BlenderJob } from "@/lib/blender/types";
import { MIN_START_MS, timeLeft } from "@/lib/graph/playTime";
import { type EntityFile, NodeError } from "@/lib/graph/types";
import { entityFile } from "./files";
import type { AssetRequest } from "./service";
import { ENGINE_CAPS } from "./spec";

export interface EntityAssets {
  /** One stored GLB per entity that got its model, named as the run holds it. */
  files: EntityFile[];
  /** The entities that will be drawn as plain shapes, and a plain sentence for each. */
  fallbacks: { entity: string; message: string }[];
}

const NO_TIME = "there was no time left to build it.";

export async function designEntityAssets(
  builder: Pick<BuilderService, "buildModel">,
  job: BlenderJob,
  requests: AssetRequest[],
  palette: readonly string[],
  now: () => number = Date.now,
): Promise<EntityAssets> {
  const out: EntityAssets = { files: [], fallbacks: [] };
  for (const [index, request] of requests.entries()) {
    if (index >= ENGINE_CAPS.generatedAssets) {
      out.fallbacks.push({ entity: request.entity, message: "only the first few entities get a built model." });
      continue;
    }
    if (timeLeft(job.deadline, now()) < MIN_START_MS) {
      out.fallbacks.push({ entity: request.entity, message: NO_TIME });
      continue;
    }
    try {
      const built = await builder.buildModel(job, {
        role: request.role,
        kind: "freeform", // composed from parts, with a PC and a phone variant; the AI's kit kind is not used
        description: request.description,
        motions: { run: "", jump: "", loop: "" },
        picture: null,
        palette,
      });
      out.files.push({ file: entityFile(request.entity), sha256: built.sha256, ...(built.mobile ? { mobile: built.mobile.sha256 } : {}) });
    } catch (error) {
      // A step's own sentence (limits, the clock, the worker) is the person's to read; anything else is only "not built".
      const message = error instanceof NodeError ? error.message.replace(/^[^:]+: /, "") : "it could not be built.";
      out.fallbacks.push({ entity: request.entity, message });
    }
  }
  return out;
}
