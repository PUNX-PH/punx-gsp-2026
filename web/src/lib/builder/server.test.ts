import { describe, expect, it } from "vitest";
import type { BlenderJob, BlenderService } from "@/lib/blender/types";
import { getBuilderService } from "@/lib/builder/server";
import { SAMPLE_PALETTE } from "@/lib/graph/palette";
import { type DerivedFiles, NodeError } from "@/lib/graph/types";

const job: BlenderJob = { user: { uid: "alice", email: "alice@punx.ai" }, graphId: "g1", derived: {} as DerivedFiles, deadline: 99 };
const input = (description: string) => ({
  role: "hero" as const,
  kind: "biped" as const,
  description,
  motions: { run: "", jump: "", loop: "" },
  picture: null,
  palette: SAMPLE_PALETTE,
});

function fakeBlender() {
  const builds: string[] = [];
  const blender: BlenderService = {
    async prepare() {
      throw new Error("not used");
    },
    async shape() {
      throw new Error("not used");
    },
    async build(_job, request) {
      builds.push(request.label);
      return { sha256: "e".repeat(64), size: 100, triangles: 180, parts: 15, clips: ["Run", "Jump"], reused: false };
    },
  };
  return { blender, builds };
}

describe("getBuilderService", () => {
  it("builds an empty biped through the Blender service it is given", async () => {
    const { blender, builds } = fakeBlender();
    const built = await getBuilderService(blender).buildModel(job, input(""));
    expect(builds).toEqual(["Build Model"]);
    expect(built).toMatchObject({ kind: "biped", parts: 15, triangles: 180, clips: ["Run", "Jump"], skipped: [], reused: false });
  });

  it("says the AI service did not answer for a description, and builds nothing (the AI half is not wired yet)", async () => {
    const { blender, builds } = fakeBlender();
    const error = await getBuilderService(blender)
      .buildModel(job, input("a red fox in a scarf"))
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Build Model: The AI service did not answer. Try again.");
    expect(builds).toHaveLength(0);
  });
});
