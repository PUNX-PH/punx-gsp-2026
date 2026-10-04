// Play runs steps one after another inside one request, so the pieces of its clock must fit inside the route's time limit:
// the deadline, the margin for the rest of Play, and the worker call's own timeout against the worker's job limit.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CALL_TIMEOUT_MS, MIN_START_MS, PLAY_BUDGET_MS, RAN_OUT_OF_TIME, WORKER_JOB_LIMIT_MS, timeLeft } from "@/lib/graph/playTime";

const route = readFileSync(new URL("../../app/api/graphs/[id]/play/route.ts", import.meta.url), "utf8");
const MARGIN_MS = 30_000; // decoding, Firestore, the Preview's run and the response

describe("timeLeft", () => {
  it("is what remains until the deadline, never below zero", () => {
    expect(timeLeft(1000, 400)).toBe(600);
    expect(timeLeft(1000, 1000)).toBe(0);
    expect(timeLeft(1000, 2000)).toBe(0);
  });
});

describe("Play's clock", () => {
  it("has a deadline that leaves a margin inside the route's time limit", () => {
    const seconds = Number(route.match(/export const maxDuration = (\d+);/)?.[1]);
    expect(PLAY_BUDGET_MS + MARGIN_MS).toBeLessThanOrEqual(seconds * 1000);
  });

  it("gives a worker call more time than the worker gives itself, so the worker's own sentence comes first", () => {
    expect(CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(WORKER_JOB_LIMIT_MS + 5_000);
  });

  it("will not start a call that could not finish", () => {
    expect(MIN_START_MS).toBeLessThan(CALL_TIMEOUT_MS);
  });

  it("has the sentence a step shows when there is no time", () => {
    expect(RAN_OUT_OF_TIME).toBe("Play ran out of time. Press Play again; finished steps are kept, so it carries on.");
  });
});
