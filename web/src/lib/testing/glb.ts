// Test helper: builds GLB files in memory, well formed or broken in one chosen way.

export interface GlbOptions {
  magic?: string; // four characters, default "glTF"
  version?: number; // default 2
  declaredLength?: number; // the length written in the header, default the real size
  bin?: Uint8Array; // an optional BIN chunk
  firstChunkType?: number; // default 0x4e4f534a ("JSON")
}

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

function padded(bytes: Uint8Array, filler: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.length / 4) * 4).fill(filler);
  out.set(bytes);
  return out;
}

export function makeGlb(json: unknown, options: GlbOptions = {}): Uint8Array {
  const jsonText = typeof json === "string" ? json : JSON.stringify(json);
  const jsonBytes = padded(new TextEncoder().encode(jsonText), 0x20);
  const binBytes = options.bin ? padded(options.bin, 0) : null;

  const total = 12 + 8 + jsonBytes.length + (binBytes ? 8 + binBytes.length : 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  const magic = options.magic ?? "glTF";
  for (let i = 0; i < 4; i++) out[i] = magic.charCodeAt(i);
  view.setUint32(4, options.version ?? 2, true);
  view.setUint32(8, options.declaredLength ?? total, true);

  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, options.firstChunkType ?? JSON_CHUNK, true);
  out.set(jsonBytes, 20);

  if (binBytes) {
    const at = 20 + jsonBytes.length;
    view.setUint32(at, binBytes.length, true);
    view.setUint32(at + 4, BIN_CHUNK, true);
    out.set(binBytes, at + 8);
  }
  return out;
}
