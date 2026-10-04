import { describe, expect, it } from "vitest";
import { fileProblem } from "@/lib/canvas/files";

describe("fileProblem", () => {
  it("is null when the file is the kind the step takes", () => {
    expect(fileProblem("reference-image", "image")).toBeNull();
    expect(fileProblem("model", "model")).toBeNull();
  });

  it("says what the step needs when the file is the wrong kind, so a bad choice never reaches the saved graph", () => {
    expect(fileProblem("reference-image", "model")).toBe("This step needs a picture (a PNG or JPEG), not a 3D model.");
    expect(fileProblem("model", "image")).toBe("This step needs a 3D model (a GLB, FBX or OBJ file), not a picture.");
  });

  it("has nothing to say about a step that takes no file", () => {
    expect(fileProblem("preview", "image")).toBeNull();
    expect(fileProblem("game-template", "model")).toBeNull();
  });
});
