// Checks an uploaded GLB (binary glTF) before it is stored. It must read the file the way the Unity player does
// (glTFast walks every part and every JSON document in it), or something could slip past that the player then acts
// on. So: a real header, version 2, a matching length, exactly one JSON part first and at most one binary part after
// it and nothing else, glTF 2, and no `uri` anywhere (a GLB keeps its data in its own binary part). Nothing here
// throws, whatever the bytes are.

export type GlbResult = { ok: true } | { ok: false; error: string };

const MAGIC = 0x46546c67; // "glTF", read as a little-endian number
const JSON_CHUNK = 0x4e4f534a; // "JSON"
const BIN_CHUNK = 0x004e4942; // "BIN\0"
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;

export function checkGlb(name: string, bytes: Uint8Array): GlbResult {
  const fail = (reason: string): GlbResult => ({ ok: false, error: `${name}: ${reason}` });
  const damaged = "damaged (the JSON part is missing or not valid)";
  const unsupported = "has parts this app does not accept (one JSON part, then at most one binary part)";

  if (bytes.length < HEADER_BYTES) return fail("not a GLB file (wrong header)");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== MAGIC) return fail("not a GLB file (wrong header)");
  if (view.getUint32(4, true) !== 2) return fail("wrong GLB version (need 2)");
  if (view.getUint32(8, true) !== bytes.length) return fail("file length does not match its header");

  // The first part: the JSON.
  if (bytes.length < HEADER_BYTES + CHUNK_HEADER_BYTES) return fail(damaged);
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK) return fail(damaged);
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (jsonLength > bytes.length - jsonStart) return fail(damaged);

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(jsonStart, jsonStart + jsonLength)));
  } catch {
    return fail(damaged);
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return fail(damaged);

  // Then at most one binary part, and nothing after it.
  let offset = jsonStart + jsonLength;
  if (offset < bytes.length) {
    if (bytes.length - offset < CHUNK_HEADER_BYTES) return fail(unsupported);
    if (view.getUint32(offset + 4, true) !== BIN_CHUNK) return fail(unsupported);
    offset += CHUNK_HEADER_BYTES + view.getUint32(offset, true);
    if (offset !== bytes.length) return fail(unsupported); // also catches a binary part that is cut off or runs past the end
  }

  const asset = (json as Record<string, unknown>).asset;
  const version = typeof asset === "object" && asset !== null ? (asset as Record<string, unknown>).version : undefined;
  if (typeof version !== "string" || !version.startsWith("2")) {
    return fail(`not glTF 2 (asset.version is ${typeof version === "string" ? version : "missing"})`);
  }

  if (hasUriKey(json)) return fail("refers to files outside itself");
  return { ok: true };
}

// True when any object anywhere in the document has a key named uri, in any letter case: glTF puts a file path, URL
// or data URI there, and the player's JSON reader may not be strict about case. Iterative, so a deeply nested
// document cannot overflow the stack.
function hasUriKey(root: unknown): boolean {
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value !== "object" || value === null) continue;
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.toLowerCase() === "uri") return true;
      pending.push(child);
    }
  }
  return false;
}
