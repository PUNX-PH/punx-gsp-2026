import { describe, expect, it } from "vitest";
import { model } from "@/lib/graph/nodes/model";
import { paletteFromImage } from "@/lib/graph/nodes/paletteFromImage";
import { referenceImage } from "@/lib/graph/nodes/referenceImage";
import { EXECUTORS } from "@/lib/graph/nodes";
import { sampleImage } from "@/lib/graph/image";
import { makePalette } from "@/lib/graph/palette";
import { type Assets, type ExecutorContext, NodeError, type WireValue } from "@/lib/graph/types";
import { makePng } from "@/lib/testing/images";

const SHA = "a".repeat(64);
const MODEL_SHA = "b".repeat(64);
const assets: Assets = {
  [SHA]: { name: "photo.png", size: 900, kind: "image", contentType: "image/png", width: 30, height: 20, uploadedAt: 0 },
  [MODEL_SHA]: { name: "hero.glb", size: 1500, kind: "model", contentType: "model/gltf-binary", uploadedAt: 0 },
};

function context(files: Record<string, Uint8Array> = {}): ExecutorContext {
  return { assets, readAsset: async (sha: string) => files[sha] ?? null } as unknown as ExecutorContext;
}

const picture: WireValue = { type: "image", sha256: SHA, name: "photo.png", width: 30, height: 20 };
const failure = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

describe("the Reference Image node", () => {
  it("hands on the chosen picture and says what it is", async () => {
    expect(await referenceImage({}, { asset: SHA }, context())).toEqual({
      output: picture,
      result: { name: "photo.png", width: 30, height: 20 },
    });
  });

  it.each([
    ["gone", "f".repeat(64)],
    ["not a picture", MODEL_SHA],
  ])("says the file is missing when it is %s", async (_label, asset) => {
    const error = await failure(referenceImage({}, { asset }, context()));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Reference Image: the file is missing. Choose it again.");
  });
});

describe("the 3D Model node", () => {
  it("hands on the chosen model and says what it is", async () => {
    expect(await model({}, { asset: MODEL_SHA }, context())).toEqual({
      output: { type: "model", sha256: MODEL_SHA, name: "hero.glb", size: 1500 },
      result: { name: "hero.glb", size: 1500 },
    });
  });

  it.each([
    ["gone", "f".repeat(64)],
    ["not a model", SHA],
  ])("says the file is missing when it is %s", async (_label, asset) => {
    const error = await failure(model({}, { asset }, context()));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("3D Model: the file is missing. Choose it again.");
  });
});

describe("the Palette from Image node", () => {
  it("makes the palette of the picture, the same every time", async () => {
    const bytes = await makePng(40, 40, [200, 40, 40]);
    const sampled = await sampleImage(bytes);
    expect(sampled.ok).toBe(true);
    if (!sampled.ok) return;

    const first = await paletteFromImage({ image: picture }, {}, context({ [SHA]: bytes }));
    const second = await paletteFromImage({ image: picture }, {}, context({ [SHA]: bytes }));

    expect(first.output).toEqual({ type: "palette", colors: makePalette(sampled.pixels) });
    expect(first).toEqual(second);
    expect(first.result).toEqual((first.output as { colors: string[] }).colors);
    expect((first.output as { colors: string[] }).colors).toHaveLength(5);
  });

  it("says the picture is missing when its bytes are gone", async () => {
    const error = await failure(paletteFromImage({ image: picture }, {}, context()));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Palette from Image: the picture is missing. Choose it again.");
  });

  it("says so when the picture is completely transparent", async () => {
    const bytes = await makePng(10, 10, [0, 0, 0], 0);
    const error = await failure(paletteFromImage({ image: picture }, {}, context({ [SHA]: bytes })));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toBe("Palette from Image: the picture is completely transparent");
  });

  it("says the picture could not be read when its bytes are corrupt", async () => {
    const bytes = new Uint8Array(100).map((_, i) => (i * 13 + 5) & 0xff);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const error = await failure(paletteFromImage({ image: picture }, {}, context({ [SHA]: bytes })));
    expect(error).toBeInstanceOf(NodeError);
    expect((error as Error).message).toMatch(/^Palette from Image: .*could not be read/);
  });

  it("is a programming error, not a message for the person, to run without a picture", async () => {
    const error = await failure(paletteFromImage({}, {}, context()));
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(NodeError);
  });
});

describe("EXECUTORS", () => {
  it("has an executor for each of these nodes", () => {
    expect(Object.keys(EXECUTORS)).toEqual(expect.arrayContaining(["model", "palette-from-image", "reference-image"]));
  });
});
