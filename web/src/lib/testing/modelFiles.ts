// Test helpers: small FBX and OBJ files in memory.

/** A binary FBX: the header, a version number, and a few bytes of body (not a whole model: only the header is read here). */
export function makeFbx(version = 7400): Uint8Array {
  const header = new TextEncoder().encode("Kaydara FBX Binary  ");
  const bytes = new Uint8Array(header.length + 3 + 4 + 16);
  bytes.set(header, 0);
  bytes[header.length] = 0x00;
  bytes[header.length + 1] = 0x1a;
  bytes[header.length + 2] = 0x00;
  new DataView(bytes.buffer).setUint32(header.length + 3, version, true);
  return bytes;
}

/** A unit cube as an OBJ: eight vertices and six quads. */
export function makeObj(): Uint8Array {
  const vertices = ["v -0.5 -0.5 -0.5", "v 0.5 -0.5 -0.5", "v 0.5 0.5 -0.5", "v -0.5 0.5 -0.5", "v -0.5 -0.5 0.5", "v 0.5 -0.5 0.5", "v 0.5 0.5 0.5", "v -0.5 0.5 0.5"];
  const faces = ["f 1 2 3 4", "f 5 8 7 6", "f 1 5 6 2", "f 2 6 7 3", "f 3 7 8 4", "f 4 8 5 1"];
  return new TextEncoder().encode(["# a cube", ...vertices, ...faces, ""].join("\n"));
}
