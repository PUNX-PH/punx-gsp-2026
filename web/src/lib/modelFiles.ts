// Recognising and checking the model files besides GLB (see glb.ts for that): a binary FBX and a text OBJ. Like a GLB they are
// untrusted, and what they are is decided from their bytes alone. These checks only look at the outside of the file (the
// header, the text); the real reading is Blender's, in its own sandbox. Nothing here throws, whatever the bytes are.
import type { GlbResult } from "@/lib/glb";

export type FileCheck = GlbResult;

const BINARY_FBX = "Kaydara FBX Binary  "; // 20 bytes, then a NUL, 0x1A and a NUL, then the version (little endian)
const ASCII_FBX = "; FBX ";
const FBX_HEADER_BYTES = BINARY_FBX.length + 3 + 4;
const OLDEST_FBX_VERSION = 6100;

const OBJ_HEAD_BYTES = 64 * 1024;
const MAX_REPLACEMENT_SHARE = 0.01; // of the first 64 KB: a stray Latin-1 byte in a comment is fine, a binary blob is not

const startsWith = (bytes: Uint8Array, text: string) => bytes.length >= text.length && Array.from(text).every((c, i) => bytes[i] === c.charCodeAt(0));

/** A binary FBX, by its header. */
export const isBinaryFbx = (bytes: Uint8Array): boolean => startsWith(bytes, BINARY_FBX);

/** An ASCII FBX, by its first line. The app does not take these (Blender's importer reads only binary FBX) but recognises them to say so. */
export const isAsciiFbx = (bytes: Uint8Array): boolean => startsWith(bytes, ASCII_FBX);

/**
 * A text OBJ: no NUL byte, text that reads as UTF-8 (a stray Latin-1 byte is allowed, a binary blob is not), and at least one
 * vertex line (`v `) and one face line (`f `) anywhere in the file.
 */
export function looksLikeObj(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.includes(0)) return false;
  const decoder = new TextDecoder("utf-8"); // not fatal: invalid bytes become U+FFFD; a byte order mark is dropped
  const head = decoder.decode(bytes.subarray(0, OBJ_HEAD_BYTES));
  const replaced = Array.from(head).filter((c) => c === "�").length;
  if (replaced > head.length * MAX_REPLACEMENT_SHARE) return false;
  const text = decoder.decode(bytes);
  return /^v /m.test(text) && /^f /m.test(text);
}

export function checkFbx(name: string, bytes: Uint8Array): FileCheck {
  const fail = (reason: string): FileCheck => ({ ok: false, error: `${name}: ${reason}` });
  if (isAsciiFbx(bytes)) return fail("an ASCII FBX file; save it as a binary FBX, or as a GLB");
  if (bytes.length < FBX_HEADER_BYTES || !isBinaryFbx(bytes)) return fail("not an FBX file (wrong header)");
  if (bytes[BINARY_FBX.length] !== 0x00 || bytes[BINARY_FBX.length + 1] !== 0x1a || bytes[BINARY_FBX.length + 2] !== 0x00) return fail("not an FBX file (wrong header)");
  const version = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(BINARY_FBX.length + 3, true);
  if (version < OLDEST_FBX_VERSION) return fail(`an FBX version this app cannot read (it needs ${OLDEST_FBX_VERSION} or newer)`);
  return { ok: true };
}

export function checkObj(name: string, bytes: Uint8Array): FileCheck {
  return looksLikeObj(bytes) ? { ok: true } : { ok: false, error: `${name}: not an OBJ file (it needs vertices and faces)` };
}
