// Test helper: builds GLB files in memory, well formed or broken in one chosen way.

export interface GlbOptions {
  magic?: string; // four characters, default "glTF"
  version?: number; // default 2
  declaredLength?: number; // the length written in the header, default the real size
  bin?: Uint8Array; // an optional BIN chunk, directly after the JSON chunk
  firstChunkType?: number; // default 0x4e4f534a ("JSON")
  extraChunks?: { type: number; data: Uint8Array }[]; // further chunks after the BIN chunk (or the JSON chunk)
  trailing?: Uint8Array; // raw bytes after the last chunk
}

export const JSON_CHUNK = 0x4e4f534a;
export const BIN_CHUNK = 0x004e4942;

function padded(bytes: Uint8Array, filler: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(filler);
  out.set(bytes);
  return out;
}

/** The JSON text of a glTF document as a padded chunk body, for tests that add a second JSON chunk. */
export function jsonChunk(json: unknown): { type: number; data: Uint8Array } {
  return { type: JSON_CHUNK, data: new TextEncoder().encode(typeof json === "string" ? json : JSON.stringify(json)) };
}

export function makeGlb(json: unknown, options: GlbOptions = {}): Uint8Array {
  const jsonText = typeof json === "string" ? json : JSON.stringify(json);
  const chunks: { type: number; body: Uint8Array }[] = [
    { type: options.firstChunkType ?? JSON_CHUNK, body: padded(new TextEncoder().encode(jsonText), 0x20) },
  ];
  if (options.bin) chunks.push({ type: BIN_CHUNK, body: padded(options.bin, 0) });
  for (const extra of options.extraChunks ?? []) chunks.push({ type: extra.type, body: padded(extra.data, extra.type === JSON_CHUNK ? 0x20 : 0) });

  const trailing = options.trailing ?? new Uint8Array(0);
  const total = 12 + chunks.reduce((sum, c) => sum + 8 + c.body.length, 0) + trailing.length;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  const magic = options.magic ?? "glTF";
  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
  view.setUint32(4, options.version ?? 2, true);
  view.setUint32(8, options.declaredLength ?? total, true);

  let at = 12;
  for (const chunk of chunks) {
    view.setUint32(at, chunk.body.length, true);
    view.setUint32(at + 4, chunk.type, true);
    out.set(chunk.body, at + 8);
    at += 8 + chunk.body.length;
  }
  out.set(trailing, at);
  return out;
}
