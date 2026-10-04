import { describe, expect, it } from "vitest";
import { checkFbx, checkObj } from "@/lib/modelFiles";
import { makeFbx, makeObj } from "@/lib/testing/modelFiles";

const text = (s: string) => new TextEncoder().encode(s);
const bad = (result: { ok: boolean; error?: string }) => {
  expect(result.ok).toBe(false);
  return result.error ?? "";
};

describe("checkFbx", () => {
  it("accepts a binary FBX with a version this app can read", () => {
    expect(checkFbx("robot.fbx", makeFbx(7400))).toEqual({ ok: true });
    expect(checkFbx("robot.fbx", makeFbx(6100))).toEqual({ ok: true });
  });

  it("refuses an old version, naming the file", () => {
    expect(bad(checkFbx("robot.fbx", makeFbx(100)))).toBe("robot.fbx: an FBX version this app cannot read (it needs 6100 or newer)");
  });

  it("refuses an ASCII FBX with a way forward", () => {
    expect(bad(checkFbx("robot.fbx", text("; FBX 7.3.0 project file\n; ----\nFBXHeaderExtension:  {\n}\n")))).toBe(
      "robot.fbx: an ASCII FBX file; save it as a binary FBX, or as a GLB",
    );
  });

  it("refuses anything else, an empty file and a header cut short included", () => {
    expect(bad(checkFbx("a.fbx", new Uint8Array(0)))).toBe("a.fbx: not an FBX file (wrong header)");
    expect(bad(checkFbx("a.fbx", text("Kaydara FBX Binary  ")))).toBe("a.fbx: not an FBX file (wrong header)");
    expect(bad(checkFbx("a.fbx", text("hello world, this is not a model at all")))).toBe("a.fbx: not an FBX file (wrong header)");
  });
});

describe("checkObj", () => {
  const cube = makeObj();

  it("accepts an OBJ with vertices and faces", () => {
    expect(checkObj("cube.obj", cube)).toEqual({ ok: true });
  });

  it("accepts a byte order mark and a stray Latin-1 byte in a comment", () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...cube]);
    expect(checkObj("cube.obj", withBom)).toEqual({ ok: true });
    const withLatin1 = new Uint8Array([...text("# made by Ren"), 0xe9, ...text("\n"), ...cube]);
    expect(checkObj("cube.obj", withLatin1)).toEqual({ ok: true });
  });

  const sentence = (name: string) => `${name}: not an OBJ file (it needs vertices and faces)`;

  it.each([
    ["JSON", text('{"vertices": [1, 2, 3], "faces": []}')],
    ["CSV", text("name,x,y,z\nfoo,1,2,3\nbar,4,5,6\n")],
    ["HTML", text("<!doctype html><html><body><p>v 1 2 3</p></body></html>")],
    ["Markdown", text("# Title\n\n- an item\n- another\n")],
    ["vertices and no faces", text("v 0 0 0\nv 1 0 0\nv 0 1 0\n")],
    ["faces and no vertices", text("f 1 2 3\n")],
    ["a NUL byte", new Uint8Array([...cube, 0])],
    ["nothing", new Uint8Array(0)],
  ])("refuses %s", (_label, bytes) => {
    expect(bad(checkObj("thing.obj", bytes))).toBe(sentence("thing.obj"));
  });

  it("refuses a random binary blob", () => {
    const blob = new Uint8Array(4000).map((_, i) => (i * 167 + 91) % 256 || 1);
    const withLines = new Uint8Array([...text("v 1 1 1\nf 1 1 1\n"), ...blob]);
    expect(bad(checkObj("thing.obj", withLines))).toBe(sentence("thing.obj"));
  });
});
