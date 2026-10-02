import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkGlb } from "@/lib/glb";
import { makeGlb } from "@/lib/testing/glb";

// web/src/lib -> repo root is three levels up.
const SAMPLE = fileURLToPath(new URL("../../../unity/runner-template/Assets/StreamingAssets/sample/hero.glb", import.meta.url));
const valid = { asset: { version: "2.0" } };

describe("checkGlb accepts", () => {
  it("the real sample GLB from the Unity template", () => {
    expect(checkGlb("hero.glb", new Uint8Array(readFileSync(SAMPLE)))).toEqual({ ok: true });
  });

  it("a minimal GLB, with and without a BIN chunk", () => {
    expect(checkGlb("hero.glb", makeGlb(valid))).toEqual({ ok: true });
    expect(checkGlb("hero.glb", makeGlb(valid, { bin: new Uint8Array([1, 2, 3, 4, 5]) }))).toEqual({ ok: true });
  });
});

describe("checkGlb rejects, naming the file and the cause", () => {
  const bad = (name: string, bytes: Uint8Array) => {
    const result = checkGlb(name, bytes);
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.error;
  };

  it("an empty file, a file shorter than the header, and a wrong magic", () => {
    expect(bad("hero.glb", new Uint8Array(0))).toBe("hero.glb: not a GLB file (wrong header)");
    expect(bad("hero.glb", new Uint8Array(11))).toBe("hero.glb: not a GLB file (wrong header)");
    expect(bad("coin.glb", makeGlb(valid, { magic: "GLTF" }))).toBe("coin.glb: not a GLB file (wrong header)");
  });

  it("version 1", () => {
    expect(bad("hero.glb", makeGlb(valid, { version: 1 }))).toBe("hero.glb: wrong GLB version (need 2)");
  });

  it("a declared length that is not the file size", () => {
    const real = makeGlb(valid);
    expect(bad("hero.glb", makeGlb(valid, { declaredLength: real.length + 4 }))).toBe("hero.glb: file length does not match its header");
  });

  it("a first chunk that is not JSON, JSON that does not parse, and a JSON chunk longer than the file", () => {
    const damaged = "hero.glb: damaged (the JSON part is missing or not valid)";
    expect(bad("hero.glb", makeGlb(valid, { firstChunkType: 0x004e4942 }))).toBe(damaged);
    expect(bad("hero.glb", makeGlb("{not json"))).toBe(damaged);
    const long = makeGlb(valid);
    new DataView(long.buffer).setUint32(12, 1_000_000, true);
    expect(bad("hero.glb", long)).toBe(damaged);
    expect(bad("hero.glb", makeGlb(valid).slice(0, 15))).toBe("hero.glb: file length does not match its header");
  });

  it("a file that is not glTF 2", () => {
    expect(bad("hero.glb", makeGlb({ asset: { version: "1.0" } }))).toBe("hero.glb: not glTF 2 (asset.version is 1.0)");
    expect(bad("hero.glb", makeGlb({}))).toBe("hero.glb: not glTF 2 (asset.version is missing)");
  });

  it.each([
    ["an external buffer", { asset: { version: "2.0" }, buffers: [{ uri: "model.bin", byteLength: 4 }] }],
    ["an external image", { asset: { version: "2.0" }, images: [{ uri: "texture.png" }] }],
    ["a data URI", { asset: { version: "2.0" }, buffers: [{ uri: "data:application/octet-stream;base64,AAAA", byteLength: 3 }] }],
  ])("%s", (_label, json) => {
    expect(bad("hero.glb", makeGlb(json))).toBe("hero.glb: refers to files outside itself");
  });

  it("accepts buffers and images that keep their data inside the file", () => {
    const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }], images: [{ bufferView: 0, mimeType: "image/png" }] };
    expect(checkGlb("hero.glb", makeGlb(json, { bin: new Uint8Array(4) }))).toEqual({ ok: true });
  });
});

describe("checkGlb on arbitrary bytes", () => {
  it("never throws and always names the file when it refuses", () => {
    // A small deterministic generator, so a failure is repeatable.
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    const base = makeGlb(valid, { bin: new Uint8Array(16) });

    for (let round = 0; round < 500; round++) {
      const bytes = round % 2 === 0 ? base.slice() : new Uint8Array(next() % 80).map(() => next() & 0xff);
      if (round % 2 === 0) for (let k = 0; k < 1 + (next() % 4); k++) bytes[next() % bytes.length] = next() & 0xff;

      const result = checkGlb("x.glb", bytes);
      if (!result.ok) expect(result.error.startsWith("x.glb: ")).toBe(true);
    }
  });
});
