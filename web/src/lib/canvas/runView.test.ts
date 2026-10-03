import { describe, expect, it } from "vitest";
import { applyPlay, emptyRunView, finalNodeId, isOutOfDate, markStale, type PlayResponse, revealSchedule } from "@/lib/canvas/runView";
import { starterGraph } from "@/lib/graph/starter";
import type { NodeOutcome } from "@/lib/graph/runner";

const allDone: Record<string, NodeOutcome> = {
  n1: { state: "done", result: { name: "p.png", width: 1, height: 1 } },
  n2: { state: "done", result: ["#000000", "#111111", "#222222", "#333333", "#ffffff"] },
  n3: { state: "done", result: { tuning: { speed: 6, jumpHeight: 2.2, obstacleSpacing: 12 } } },
  n4: { state: "done", result: { runId: "run2" } },
  n5: { state: "not-used" },
};
const ran = (nodes: Record<string, NodeOutcome>, extra: Partial<Extract<PlayResponse, { kind: "ran" }>> = {}): PlayResponse => ({
  kind: "ran",
  state: "done",
  order: ["n1", "n2", "n3", "n4"],
  nodes,
  runId: "run2",
  ...extra,
});

describe("finalNodeId", () => {
  it("is the Preview, or null when there is none", () => {
    expect(finalNodeId(starterGraph())).toBe("n4");
    expect(finalNodeId({ ...starterGraph(), nodes: starterGraph().nodes.filter((n) => n.id !== "n4") })).toBeNull();
  });
});

describe("applyPlay", () => {
  it("takes the outcomes, the order and the run from a run, and forgets problems and stale marks", () => {
    const before = { ...emptyRunView("run1"), problems: [{ node: "n1", message: "x" }], stale: ["n2"] };
    const after = applyPlay(before, starterGraph(), ran(allDone));
    expect(after).toEqual({ runId: "run2", order: ["n1", "n2", "n3", "n4"], outcomes: allDone, problems: [], stale: [], ranOnce: true });
  });

  it("forgets the old run when the Preview itself failed (it was deleted to make room)", () => {
    const outcomes = { ...allDone, n4: { state: "failed", error: "Preview: You have 20 runs. Delete one first." } as NodeOutcome };
    const after = applyPlay(emptyRunView("run1"), starterGraph(), { kind: "ran", state: "failed", order: ["n1", "n2", "n3", "n4"], nodes: outcomes });
    expect(after.runId).toBeNull();
  });

  it("keeps the old run when the Preview was skipped, because it was never touched", () => {
    const outcomes = { ...allDone, n3: { state: "failed", error: "x" } as NodeOutcome, n4: { state: "skipped", because: "y" } as NodeOutcome };
    const after = applyPlay(emptyRunView("run1"), starterGraph(), { kind: "ran", state: "failed", order: ["n1", "n2", "n3", "n4"], nodes: outcomes });
    expect(after.runId).toBe("run1");
  });

  it("keeps the problems of an unfinished graph, clears the outcomes, and leaves the run alone", () => {
    const before = { ...emptyRunView("run1"), outcomes: allDone, stale: ["n3"], ranOnce: true };
    const problems = [{ node: "n1", message: "Reference Image: choose a picture." }];
    const after = applyPlay(before, starterGraph(), { kind: "invalid", problems });
    expect(after).toMatchObject({ runId: "run1", problems, outcomes: {}, stale: ["n3"], ranOnce: true });
  });
});

describe("markStale", () => {
  const played = () => applyPlay(emptyRunView(null), starterGraph(), ran(allDone));

  it("clears the results and problems of the touched steps and everything downstream, and lists them", () => {
    const withProblem = { ...played(), problems: [{ node: "n3", message: "x" }] };
    const after = markStale(withProblem, starterGraph(), ["n2"]);
    expect(Object.keys(after.outcomes).sort()).toEqual(["n1", "n5"]);
    expect([...after.stale].sort()).toEqual(["n2", "n3", "n4"]);
    expect(after.problems).toEqual([]);
  });

  it("changes nothing when nothing was touched (a move)", () => {
    const view = played();
    expect(markStale(view, starterGraph(), [])).toBe(view);
  });

  it("keeps earlier stale marks", () => {
    const first = markStale(played(), starterGraph(), ["n3"]);
    const second = markStale(first, starterGraph(), ["n1"]);
    expect([...second.stale].sort()).toEqual(["n1", "n2", "n3", "n4"]);
  });
});

describe("isOutOfDate", () => {
  const played = () => applyPlay(emptyRunView(null), starterGraph(), ran(allDone));

  it("is false right after a run", () => {
    expect(isOutOfDate(played(), starterGraph())).toBe(false);
  });

  it("is true after touching a step that leads to the Preview", () => {
    expect(isOutOfDate(markStale(played(), starterGraph(), ["n2"]), starterGraph())).toBe(true);
  });

  it("is false when only the unconnected step was touched", () => {
    expect(isOutOfDate(markStale(played(), starterGraph(), ["n5"]), starterGraph())).toBe(false);
  });
});

describe("revealSchedule", () => {
  it("reveals one step at a time", () => {
    expect(revealSchedule(["a", "b", "c"], 150, false)).toEqual([{ node: "a", atMs: 0 }, { node: "b", atMs: 150 }, { node: "c", atMs: 300 }]);
  });

  it("finishes a 50-step graph within 1.5 seconds (Review Focus 4)", () => {
    const order = Array.from({ length: 50 }, (_, i) => `n${i}`);
    const schedule = revealSchedule(order, 150, false);
    expect(schedule).toHaveLength(50);
    expect(schedule.at(-1)!.atMs).toBeLessThanOrEqual(1500);
    expect(schedule[1].atMs).toBeGreaterThan(0);
  });

  it("shows everything at once when reduced motion is preferred, and handles no steps", () => {
    expect(revealSchedule(["a", "b"], 150, true).map((s) => s.atMs)).toEqual([0, 0]);
    expect(revealSchedule([], 150, false)).toEqual([]);
  });
});

