import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MAX_IMAGE_PIXELS, readImage, sampleImage, sniffKind } from "@/lib/graph/image";
import { makeGlb } from "@/lib/testing/glb";
import { makeJpeg, makePng, makePngFromPixels } from "@/lib/testing/images";

const text = (s: string) => new TextEncoder().encode(s);
const triples = (pixels: Uint8Array) =>
  Array.from({ length: pixels.length / 3 }, (_, i) => [pixels[3 * i], pixels[3 * i + 1], pixels[3 * i + 2]]);

describe("sniffKind", () => {
  it.each([
    ["a PNG", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "png"],
    ["a JPEG", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]), "jpeg"],
    ["a GLB", makeGlb({ asset: { version: "2.0" } }), "glb"],
    ["an SVG", text("<svg xmlns='http://www.w3.org/2000/svg'/>"), null],
    ["a GIF", text("GIF89a......"), null],
    ["nothing", new Uint8Array(0), null],
    ["plain text", text("hello world"), null],
    ["a truncated PNG signature", Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), null],
  ])("recognises %s", (_label, bytes, expected) => {
    expect(sniffKind(bytes)).toBe(expected);
  });
});

describe("readImage", () => {
  it("reads the size of a PNG", async () => {
    expect(await readImage(await makePng(10, 20, [200, 30, 30]))).toEqual({ ok: true, width: 10, height: 20 });
  });

  it("reads a JPEG, a grayscale PNG and a 1 x 1 PNG", async () => {
    expect(await readImage(await makeJpeg(30, 40, [10, 200, 10]))).toEqual({ ok: true, width: 30, height: 40 });
    const grey = await sharp(await makePng(10, 20, [128, 128, 128])).greyscale().png().toBuffer();
    expect(await readImage(grey)).toEqual({ ok: true, width: 10, height: 20 });
    expect(await readImage(await makePng(1, 1, [1, 2, 3]))).toEqual({ ok: true, width: 1, height: 1 });
  });

  it("refuses a picture over the pixel limit, before decoding it", async () => {
    expect(6000 * 5000).toBeGreaterThan(MAX_IMAGE_PIXELS);
    const result = await readImage(await makePng(6000, 5000, [1, 2, 3]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("25 million pixels");
  });

  it("refuses bytes that start like a PNG but are not one", async () => {
    const bytes = new Uint8Array(120).map((_, i) => (i * 37 + 11) & 0xff);
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await readImage(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("could not be read");
  });

  it.each([
    ["plain text", text("hello world")],
    ["an SVG", text("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>")],
    ["a GLB", makeGlb({ asset: { version: "2.0" } })],
  ])("refuses %s as not a PNG or JPEG", async (_label, bytes) => {
    const result = await readImage(bytes);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not a PNG or JPEG");
  });
});

describe("sampleImage", () => {
  it("shrinks a large picture to fit 64 x 64 and returns its colors as RGB triples", async () => {
    const result = await sampleImage(await makePng(100, 100, [255, 0, 0]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixels.length).toBe(64 * 64 * 3);
    expect(triples(result.pixels).every((t) => t[0] === 255 && t[1] === 0 && t[2] === 0)).toBe(true);
  });

  it("does not enlarge a small picture", async () => {
    const result = await sampleImage(await makePng(10, 10, [1, 2, 3]));
    expect(result.ok && result.pixels.length).toBe(300);
  });

  it("ignores transparent pixels, so a logo's colors come out and not black", async () => {
    const rgba = new Uint8Array(10 * 10 * 4);
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const at = (y * 10 + x) * 4;
        rgba.set(x < 5 ? [0, 0, 0, 0] : [0, 255, 0, 255], at);
      }
    }
    const result = await sampleImage(await makePngFromPixels(10, 10, rgba));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const found = triples(result.pixels);
    expect(found).toHaveLength(50);
    expect(found.every((t) => t[0] === 0 && t[1] === 255 && t[2] === 0)).toBe(true);
  });

  it("returns RGB triples for a grayscale picture too", async () => {
    const grey = await sharp(await makePng(8, 8, [100, 100, 100])).greyscale().png().toBuffer();
    const result = await sampleImage(grey);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pixels.length).toBe(8 * 8 * 3);
    expect(triples(result.pixels).every((t) => t[0] === t[1] && t[1] === t[2])).toBe(true);
  });

  it("says so when the whole picture is transparent", async () => {
    expect(await sampleImage(await makePng(10, 10, [0, 0, 0], 0))).toEqual({
      ok: false,
      error: "the picture is completely transparent",
    });
  });

  it("refuses what readImage refuses", async () => {
    expect((await sampleImage(text("hello world"))).ok).toBe(false);
    expect((await sampleImage(await makePng(6000, 5000, [1, 2, 3]))).ok).toBe(false);
  });
});
