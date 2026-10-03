import { afterEach, describe, expect, it, vi } from "vitest";
import { playGraph, saveGraph, SESSION_EXPIRED, uploadFile } from "@/lib/canvas/client";
import { starterGraph } from "@/lib/graph/starter";

afterEach(() => vi.unstubAllGlobals());

function answer(status: number, body: unknown) {
  const fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

function offline() {
  const fetch = vi.fn(async () => {
    throw new TypeError("Failed to fetch");
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("saveGraph", () => {
  it("sends the graph with PUT and says it worked", async () => {
    const fetch = answer(200, {});
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("/api/graphs/g1", { method: "PUT", body: JSON.stringify({ graph: starterGraph() }) });
  });

  it("says the session expired on a 401, and does not offer a retry", async () => {
    answer(401, { error: "Your session has expired. Sign in again." });
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: false, message: SESSION_EXPIRED, retryable: false });
  });

  it("passes on the server's sentence for a refusal (400, 413), without a retry", async () => {
    answer(400, { error: "Palette from Image: asset must be an uploaded file, or nothing yet." });
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: false, message: "Palette from Image: asset must be an uploaded file, or nothing yet.", retryable: false });
    answer(413, { error: "The graph is larger than 64 KB" });
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: false, message: "The graph is larger than 64 KB", retryable: false });
  });

  it("offers a retry after a server fault, with a plain sentence when none was given", async () => {
    answer(500, {});
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: false, message: "Something went wrong on our side", retryable: true });
  });

  it("offers a retry when the server cannot be reached", async () => {
    offline();
    expect(await saveGraph("g1", starterGraph())).toEqual({ ok: false, message: "Couldn't reach the server.", retryable: true });
  });
});

describe("uploadFile", () => {
  const picture = (size = 10) => new File([new Uint8Array(size)], "photo.png", { type: "image/png" });

  it("refuses a file over 4 MB without sending it, naming the file", async () => {
    const fetch = answer(201, {});
    const result = await uploadFile("g1", picture(4 * 1024 * 1024 + 1));
    expect(result).toEqual({ ok: false, message: "photo.png: larger than 4 MB", expired: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("leaves direction-changing marks in a file name out of the sentence, so they cannot reorder the rest of it", async () => {
    const fetch = answer(201, {});
    const tricky = new File([new Uint8Array(4 * 1024 * 1024 + 1)], "a\u202Eb\u2066c\u200Fd\u061Ce.png", { type: "image/png" });
    const result = await uploadFile("g1", tricky);
    expect(result).toEqual({ ok: false, message: "abcde.png: larger than 4 MB", expired: false });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shortens a very long file name in the sentence without cutting a character in half", async () => {
    const long = new File([new Uint8Array(4 * 1024 * 1024 + 1)], `${"😀".repeat(100)}.png`, { type: "image/png" });
    const result = await uploadFile("g1", long);
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.message;
    expect(message).toBe(`${"😀".repeat(59)}…: larger than 4 MB`);
    expect(message.isWellFormed()).toBe(true);
  });

  it("also leaves those marks out of a sentence the server sends back", async () => {
    answer(400, { error: "The file \u202Efdp.png is not a picture." });
    const result = await uploadFile("g1", picture());
    expect(result).toEqual({ ok: false, message: "The file fdp.png is not a picture.", expired: false });
  });

  it("sends the file as the body with its name in the query, and returns the new file", async () => {
    const fetch = answer(201, { sha256: "a".repeat(64), name: "photo.png", size: 10, kind: "image", width: 30, height: 20 });
    const file = picture();
    const result = await uploadFile("g1", file);

    expect(fetch).toHaveBeenCalledWith("/api/graphs/g1/assets?name=photo.png", { method: "POST", body: file });
    expect(result).toEqual({
      ok: true,
      sha256: "a".repeat(64),
      info: { name: "photo.png", size: 10, kind: "image", contentType: "", width: 30, height: 20, uploadedAt: expect.any(Number) },
    });
  });

  it("encodes a file name that needs it", async () => {
    const fetch = answer(201, { sha256: "b".repeat(64), name: "my photo & more.png", size: 10, kind: "image" });
    await uploadFile("g1", new File([new Uint8Array(10)], "my photo & more.png"));
    expect(fetch).toHaveBeenCalledWith("/api/graphs/g1/assets?name=my%20photo%20%26%20more.png", expect.anything());
  });

  it("passes on the server's sentence when it refuses the file", async () => {
    answer(400, { error: "photo.png: not a PNG, JPEG or GLB file" });
    expect(await uploadFile("g1", picture())).toEqual({ ok: false, message: "photo.png: not a PNG, JPEG or GLB file", expired: false });
  });

  it("says the session expired on a 401", async () => {
    answer(401, {});
    expect(await uploadFile("g1", picture())).toEqual({ ok: false, message: SESSION_EXPIRED, expired: true });
  });

  it("says the upload did not finish when the server cannot be reached", async () => {
    offline();
    expect(await uploadFile("g1", picture())).toEqual({ ok: false, message: "The upload did not finish. Check your connection and try again.", expired: false });
  });
});

describe("playGraph", () => {
  it("returns a run with its states and the game's run id", async () => {
    const body = { state: "done", order: ["n1"], nodes: { n1: { state: "done" } }, runId: "run1" };
    const fetch = answer(200, body);
    expect(await playGraph("g1")).toEqual({ kind: "ran", ...body });
    expect(fetch).toHaveBeenCalledWith("/api/graphs/g1/play", { method: "POST" });
  });

  it("returns the problems of an unfinished graph on a 422", async () => {
    const problems = [{ node: "n1", message: "Reference Image: choose a picture." }];
    answer(422, { problems });
    expect(await playGraph("g1")).toEqual({ kind: "invalid", problems });
  });

  it("says the session expired on a 401", async () => {
    answer(401, {});
    expect(await playGraph("g1")).toEqual({ kind: "expired" });
  });

  it("gives the server's sentence, or a plain one, for any other failure", async () => {
    answer(500, { error: "Something went wrong on our side" });
    expect(await playGraph("g1")).toEqual({ kind: "failed", message: "Something went wrong on our side" });
    answer(200, { nonsense: true });
    expect(await playGraph("g1")).toEqual({ kind: "failed", message: "Something went wrong on our side" });
    offline();
    expect(await playGraph("g1")).toEqual({ kind: "failed", message: "Couldn't reach the server." });
  });
});
