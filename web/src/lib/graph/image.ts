// Reading pictures that people upload. They are untrusted: the kind is decided from the first bytes (never the name or
// the declared type), the size is checked before any pixel is decoded, and every failure becomes a plain sentence
// without a node name (the caller adds that).
import sharp from "sharp";
import { isAsciiFbx, isBinaryFbx, looksLikeObj } from "@/lib/modelFiles";

export const MAX_IMAGE_PIXELS = 25_000_000;

const SAMPLE_SIZE = 64;
const OPAQUE_FROM = 128;

const NOT_A_PICTURE = "this is not a PNG or JPEG picture";
const TOO_BIG = "this picture is more than 25 million pixels. Choose a smaller one.";
const UNREADABLE = "this picture could not be read. Choose another file.";
const TRANSPARENT = "the picture is completely transparent";

// No cache, and one libvips thread: a decode must not hold on to memory or crowd out other requests.
sharp.cache(false);
sharp.concurrency(1);

const DECODE = { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" } as const;

export type FileKind = "png" | "jpeg" | "glb" | "fbx" | "obj";

const SIGNATURES: [FileKind, number[]][] = [
  ["png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["jpeg", [0xff, 0xd8, 0xff]],
  ["glb", [0x67, 0x6c, 0x54, 0x46]], // "glTF"
];

/** What a file is, from its bytes alone (never its name); null when it is none of these. A text file counts as an OBJ only if it reads as one. */
export function sniffKind(bytes: Uint8Array): FileKind | null {
  for (const [kind, signature] of SIGNATURES) {
    if (bytes.length >= signature.length && signature.every((b, i) => bytes[i] === b)) return kind;
  }
  if (isBinaryFbx(bytes) || isAsciiFbx(bytes)) return "fbx"; // an ASCII FBX is named here so that the upload can refuse it in its own words
  return looksLikeObj(bytes) ? "obj" : null;
}

type Failure = { ok: false; error: string };

// The picture's size, or why it cannot be used. Only the header is read here.
async function inspect(bytes: Uint8Array): Promise<{ ok: true; width: number; height: number } | Failure> {
  const kind = sniffKind(bytes);
  if (kind !== "png" && kind !== "jpeg") return { ok: false, error: NOT_A_PICTURE };
  try {
    const { width, height } = await sharp(bytes, DECODE).metadata();
    if (!width || !height) return { ok: false, error: UNREADABLE };
    if (width * height > MAX_IMAGE_PIXELS) return { ok: false, error: TOO_BIG };
    return { ok: true, width, height };
  } catch (error) {
    return { ok: false, error: /pixel limit/i.test(String(error)) ? TOO_BIG : UNREADABLE };
  }
}

// The picture shrunk to fit SAMPLE_SIZE (never enlarged), as 8-bit sRGB with an alpha channel: four bytes a pixel.
async function decodeSmall(bytes: Uint8Array): Promise<Uint8Array> {
  const { data } = await sharp(bytes, DECODE)
    .rotate()
    .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8Array(data);
}

/** The picture's size. The whole file is decoded once, so a corrupt picture is refused here and not at Play. */
export async function readImage(
  bytes: Uint8Array,
): Promise<{ ok: true; width: number; height: number } | Failure> {
  const header = await inspect(bytes);
  if (!header.ok) return header;
  try {
    await decodeSmall(bytes);
  } catch {
    return { ok: false, error: UNREADABLE };
  }
  return header;
}

/** The colors of the picture as packed RGB triples, leaving out pixels that are mostly transparent. */
export async function sampleImage(bytes: Uint8Array): Promise<{ ok: true; pixels: Uint8Array } | Failure> {
  const header = await inspect(bytes);
  if (!header.ok) return header;

  let rgba: Uint8Array;
  try {
    rgba = await decodeSmall(bytes);
  } catch {
    return { ok: false, error: UNREADABLE };
  }

  const pixels = new Uint8Array((rgba.length / 4) * 3);
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < OPAQUE_FROM) continue;
    pixels.set(rgba.subarray(i, i + 3), count * 3);
    count++;
  }
  if (count === 0) return { ok: false, error: TRANSPARENT };
  return { ok: true, pixels: pixels.slice(0, count * 3) };
}

const MODEL_PICTURE_SIDE = 1024;

/**
 * The copy of a picture that is sent to the model: upright, at most 1024 pixels on its long side (never enlarged), on white
 * where it was transparent, as a JPEG with no metadata. The upload itself is never forwarded. Fails with the reader's sentences.
 */
export async function pictureForModel(bytes: Uint8Array): Promise<{ ok: true; jpeg: Uint8Array } | Failure> {
  const header = await inspect(bytes);
  if (!header.ok) return header;
  try {
    const jpeg = await sharp(bytes, DECODE)
      .rotate()
      .resize(MODEL_PICTURE_SIDE, MODEL_PICTURE_SIDE, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 80 })
      .toBuffer();
    return { ok: true, jpeg: new Uint8Array(jpeg) };
  } catch {
    return { ok: false, error: UNREADABLE };
  }
}
