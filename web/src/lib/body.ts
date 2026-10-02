// Reads a request body with a hard size cap, so an oversized upload is refused without being held in memory.

export class TooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`body larger than ${maxBytes} bytes`);
    this.name = "TooLargeError";
  }
}

/** The whole body as bytes; throws TooLargeError as soon as it is known to be over maxBytes. */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<Uint8Array> {
  // A declared length over the cap is refused before a single byte is read.
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) throw new TooLargeError(maxBytes);

  if (!req.body) return new Uint8Array(0);

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new TooLargeError(maxBytes);
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
