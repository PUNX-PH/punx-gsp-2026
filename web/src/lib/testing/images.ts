// Test helpers: small pictures made with sharp, so tests need no image files.
import sharp from "sharp";

type Rgb = [number, number, number];

const bytes = (buffer: Buffer): Uint8Array => new Uint8Array(buffer);

/** A solid PNG. `alpha` is 0 (transparent) to 255 (opaque). */
export async function makePng(width: number, height: number, rgb: Rgb, alpha = 255): Promise<Uint8Array> {
  const background = { r: rgb[0], g: rgb[1], b: rgb[2], alpha: alpha / 255 };
  return bytes(await sharp({ create: { width, height, channels: 4, background } }).png().toBuffer());
}

/** A solid JPEG (JPEG has no transparency). */
export async function makeJpeg(width: number, height: number, rgb: Rgb): Promise<Uint8Array> {
  const background = { r: rgb[0], g: rgb[1], b: rgb[2] };
  return bytes(await sharp({ create: { width, height, channels: 3, background } }).jpeg().toBuffer());
}

/** A PNG from raw RGBA bytes (four per pixel, row by row). */
export async function makePngFromPixels(width: number, height: number, rgba: Uint8Array): Promise<Uint8Array> {
  return bytes(await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer());
}
