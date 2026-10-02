import { describe, expect, it } from "vitest";
import { readBodyCapped, TooLargeError } from "@/lib/body";

// A request whose body is a stream of the given chunks, counting how often the stream is asked for more.
function fakeRequest(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const queue = [...chunks];
  const counter = { pulls: 0 };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      counter.pulls++;
      const next = queue.shift();
      if (next) controller.enqueue(next);
      else controller.close();
    },
  });
  return { req: { headers: new Headers(headers), body } as unknown as Request, counter, body };
}

const bytes = (n: number, fill = 7) => new Uint8Array(n).fill(fill);

describe("readBodyCapped", () => {
  it("returns every byte of a body under the cap, across chunks", async () => {
    const { req } = fakeRequest([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
    expect(Array.from(await readBodyCapped(req, 10))).toEqual([1, 2, 3, 4, 5]);
  });

  it("accepts a body of exactly the cap and refuses one byte more", async () => {
    await expect(readBodyCapped(fakeRequest([bytes(10)]).req, 10)).resolves.toHaveLength(10);
    await expect(readBodyCapped(fakeRequest([bytes(11)]).req, 10)).rejects.toBeInstanceOf(TooLargeError);
  });

  it("refuses on a Content-Length over the cap without reading the stream", async () => {
    const { req, counter, body } = fakeRequest([bytes(5)], { "content-length": "11" });
    await expect(readBodyCapped(req, 10)).rejects.toBeInstanceOf(TooLargeError);
    expect(body.locked).toBe(false);
    expect(counter.pulls).toBeLessThanOrEqual(1); // a stream may prefetch once; it is never read
  });

  it("stops reading at the first chunk that passes the cap when there is no Content-Length", async () => {
    const { req, counter } = fakeRequest(Array.from({ length: 50 }, () => bytes(4)));
    await expect(readBodyCapped(req, 10)).rejects.toBeInstanceOf(TooLargeError);
    expect(counter.pulls).toBeLessThan(10);
  });

  it("returns zero bytes for an empty body", async () => {
    const empty = new Request("https://studio.punx.ai/api/runs", { method: "POST" });
    expect(await readBodyCapped(empty, 10)).toHaveLength(0);
  });

  it("reads a real Request body", async () => {
    const real = new Request("https://studio.punx.ai/api/runs", { method: "POST", body: new Uint8Array([9, 8, 7]) });
    expect(Array.from(await readBodyCapped(real, 10))).toEqual([9, 8, 7]);
  });

  it("carries the cap on the error", async () => {
    const error = await readBodyCapped(fakeRequest([bytes(20)]).req, 10).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TooLargeError);
    expect((error as TooLargeError).maxBytes).toBe(10);
  });
});
