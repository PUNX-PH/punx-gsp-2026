// Play runs the Describe Game call inside one request. If Vercel stops that request before the SDK's own timeout fires, the person
// gets a generic failure and the daily count is never given back. So the route's time limit must outlast the model call in the
// worst case: every attempt (the first and each retry) taking its full timeout, plus room for the rest of Play.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_TIMEOUT_MS, MAX_RETRIES } from "@/lib/ai/anthropic";

const route = readFileSync(new URL("../../app/api/graphs/[id]/play/route.ts", import.meta.url), "utf8");
const MARGIN_MS = 30_000; // decoding the picture, Firestore, the Preview's run, and the response

describe("the Play route's time limit", () => {
  it("is declared in the route file", () => {
    expect(route).toMatch(/export const maxDuration = \d+;/);
  });

  it("outlasts the model call in the worst case, with room for the rest of Play", () => {
    const seconds = Number(route.match(/export const maxDuration = (\d+);/)?.[1]);
    const worstCaseMs = DEFAULT_TIMEOUT_MS * (MAX_RETRIES + 1);
    expect(seconds * 1000).toBeGreaterThanOrEqual(worstCaseMs + MARGIN_MS);
  });

  it("is within what Vercel allows on every plan with Fluid compute (300 seconds)", () => {
    expect(Number(route.match(/export const maxDuration = (\d+);/)?.[1])).toBeLessThanOrEqual(300);
  });
});
