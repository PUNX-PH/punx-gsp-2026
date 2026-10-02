// Checks an uploaded GLB (binary glTF) before it is stored. Only the structure is checked: a real header, version 2,
// a length that matches, a JSON part that parses, glTF 2, and no reference to anything outside the file (a GLB keeps
// its data in its own BIN chunk). Nothing here throws, whatever the bytes are.

export type GlbResult = { ok: true } | { ok: false; error: string };

const MAGIC = 0x46546c67; // "glTF", read as a little-endian number
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export function checkGlb(name: string, bytes: Uint8Array): GlbResult {
  const fail = (reason: string): GlbResult => ({ ok: false, error: `${name}: ${reason}` });
  const damaged = "damaged (the JSON part is missing or not valid)";

  if (bytes.length < HEADER_BYTES) return fail("not a GLB file (wrong header)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) return fail("not a GLB file (wrong header)");
  if (view.getUint32(4, true) !== 2) return fail("wrong GLB version (need 2)");
  if (view.getUint32(8, true) !== bytes.length) return fail("file length does not match its header");

  if (bytes.length < HEADER_BYTES + CHUNK_HEADER_BYTES) return fail(damaged);
  const chunkLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) return fail(damaged);
  const start = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (chunkLength > bytes.length - start) return fail(damaged);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, start + chunkLength)));
  } catch {
    return fail(damaged);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail(damaged);
  const gltf = json as Record<string, unknown>;

  const asset = gltf.asset;
  const version = typeof asset === "object" && asset !== null ? (asset as Record<string, unknown>).version : undefined;
  if (typeof version !== "string" || !version.startsWith("2")) {
    return fail(`not glTF 2 (asset.version is ${typeof version === "string" ? version : "missing"})`);
  }

  if (hasUri(gltf.buffers) || hasUri(gltf.images)) return fail("refers to files outside itself");
  return { ok: true };
}

// True when any entry of a buffers or images list names a uri (a file path, URL or data URI).
function hasUri(list: unknown): boolean {
  return Array.isArray(list) && list.some((entry) => typeof entry === "object" && entry !== null && "uri" in entry);
}
