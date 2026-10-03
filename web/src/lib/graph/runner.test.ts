import { describe, expect, it } from "vitest";
import type { NodeSpec } from "@/lib/graph/registry";
import { type RunEvent, runGraph } from "@/lib/graph/runner";
import { type Executor, type ExecutorContext, type Graph, NodeError, type WireValue } from "@/lib/graph/types";

const port = (name: string) => ({ name, label: name, help: name, type: "palette" as const, required: false });
const spec = (type: string, label: string, inputs: string[], outputs: string[], final = false): NodeSpec => ({
  type,
  label,
  help: label,
  final,
  inputs: inputs.map(port),
  outputs: outputs.map(port),
  defaultParams: () => ({}),
  shapeProblem: () => null,
  incompleteProblem: () => null,
});

const specs: Record<string, NodeSpec> = {
  src: spec("src", "Source", [], ["out"]),
  mid: spec("mid", "Middle", ["in"], ["out"]),
  sink: spec("sink", "Sink", ["in", "in2"], [], true),
};

const palette = (color: string): WireValue => ({ type: "palette", colors: [color] });

/** Nodes as [id, type]; wires as [from, to, toPort]; every output port is called "out". */
function graph(nodes: [string, string][], wires: [string, string, string?][]): Graph {
  return {
    schemaVersion: 1,
    nodes: nodes.map(([id, type]) => ({ id, type, params: { tag: id }, position: { x: 0, y: 0 } })),
    edges: wires.map(([from, to, toPort]) => ({ from: { node: from, port: "out" }, to: { node: to, port: toPort ?? "in" } })),
  };
}

const ctx = {} as ExecutorContext;

function setup(overrides: Record<string, Executor> = {}) {
  const ran: string[] = [];
  const inputsSeen = new Map<string, Partial<Record<string, WireValue>>>();
  const base: Executor = async (inputs, params) => {
    const tag = params.tag as string;
    ran.push(tag);
    inputsSeen.set(tag, inputs);
    return { output: palette(tag), result: tag };
  };
  const executors: Record<string, Executor> = { src: base, mid: base, sink: base, ...overrides };
  return { ran, inputsSeen, executors };
}

describe("a run that works", () => {
  it("runs what leads to the Preview, in order, and says what happened", async () => {
    const { ran, executors } = setup();
    const g = graph([["a", "src"], ["b", "mid"], ["c", "sink"], ["z", "src"]], [["a", "b"], ["b", "c"]]);
    const seen: RunEvent[] = [];

    const result = await runGraph(g, { executors, ctx, specs }, (e) => seen.push(e));

    expect(result.events).toEqual([
      { type: "node-started", node: "a" },
      { type: "node-done", node: "a", result: "a" },
      { type: "node-started", node: "b" },
      { type: "node-done", node: "b", result: "b" },
      { type: "node-started", node: "c" },
      { type: "node-done", node: "c", result: "c" },
      { type: "run-done", state: "done" },
    ]);
    expect(seen).toEqual(result.events);
    expect(result.state).toBe("done");
    expect(result.order).toEqual(["a", "b", "c"]);
    expect(result.nodes.a).toEqual({ state: "done", result: "a" });
    expect(result.nodes.z).toEqual({ state: "not-used" });
    expect(ran).toEqual(["a", "b", "c"]); // z never ran
  });

  it("hands a node's output to the node it feeds, at the port the wire ends on", async () => {
    const { inputsSeen, executors } = setup();
    await runGraph(graph([["a", "src"], ["c", "sink"]], [["a", "c"]]), { executors, ctx, specs });
    expect(inputsSeen.get("c")?.in).toEqual(palette("a"));
    expect(inputsSeen.get("c")?.in2).toBeUndefined();
  });

  it("leaves an unconnected port out of the inputs", async () => {
    const { inputsSeen, executors } = setup();
    await runGraph(graph([["m", "mid"], ["c", "sink"]], [["m", "c"]]), { executors, ctx, specs });
    expect(inputsSeen.get("m")?.in).toBeUndefined();
    expect("in" in (inputsSeen.get("m") ?? {})).toBe(false);
  });

  it("runs an output that feeds two nodes only once", async () => {
    const { ran, executors } = setup();
    const g = graph([["a", "src"], ["b1", "mid"], ["b2", "mid"], ["c", "sink"]], [["a", "b1"], ["a", "b2"], ["b1", "c"], ["b2", "c", "in2"]]);
    const result = await runGraph(g, { executors, ctx, specs });
    expect(ran.filter((t) => t === "a")).toHaveLength(1);
    expect(result.state).toBe("done");
  });

  it("takes the lowest id first when two nodes are ready", async () => {
    const { executors } = setup();
    const g = graph([["b", "src"], ["a", "src"], ["c", "sink"]], [["a", "c"], ["b", "c", "in2"]]);
    expect((await runGraph(g, { executors, ctx, specs })).order).toEqual(["a", "b", "c"]);
  });

  it("runs one node at a time", async () => {
    let busy = false;
    let overlapped = false;
    const slow: Executor = async () => {
      if (busy) overlapped = true;
      busy = true;
      await new Promise((resolve) => setTimeout(resolve, 2));
      busy = false;
      return { output: palette("x"), result: null };
    };
    const g = graph([["a", "src"], ["b", "src"], ["c", "sink"]], [["a", "c"], ["b", "c", "in2"]]);
    await runGraph(g, { executors: { src: slow, mid: slow, sink: slow }, ctx, specs });
    expect(overlapped).toBe(false);
  });
});

describe("a run that fails", () => {
  const failing: Executor = async () => {
    throw new NodeError("x");
  };

  it("reports the failure on its node, skips what depends on it, and lets the other branch finish", async () => {
    const { executors } = setup({ mid: failing });
    const g = graph([["a", "src"], ["b", "mid"], ["c", "sink"], ["d", "src"]], [["a", "b"], ["b", "c"], ["d", "c", "in2"]]);

    const result = await runGraph(g, { executors, ctx, specs });

    expect(result.nodes.b).toEqual({ state: "failed", error: "x" });
    expect(result.nodes.c.state).toBe("skipped");
    expect(result.nodes.c.because).toContain("Middle");
    expect(result.nodes.d.state).toBe("done");
    expect(result.nodes.a.state).toBe("done");
    expect(result.state).toBe("failed");
    expect(result.order).toEqual(["a", "b", "d", "c"]);
    expect(result.events).toContainEqual({ type: "node-failed", node: "b", error: "x" });
    expect(result.events.find((e) => e.type === "node-skipped")).toMatchObject({ node: "c" });
    expect(result.events.at(-1)).toEqual({ type: "run-done", state: "failed" });
  });

  it("skips a node whose source failed even when that input is optional (a default must not hide a failure)", async () => {
    const { ran, executors } = setup({ src: failing });
    const result = await runGraph(graph([["a", "src"], ["b", "mid"], ["c", "sink"]], [["a", "b"], ["b", "c"]]), { executors, ctx, specs });
    expect(result.nodes.a.state).toBe("failed");
    expect(result.nodes.b.state).toBe("skipped");
    expect(result.nodes.c.state).toBe("skipped");
    expect(ran).toEqual([]);
  });

  it("says only 'Something went wrong on our side' for an unexpected error, and logs no message", async () => {
    const explode: Executor = async () => {
      throw new Error("secret-bytes");
    };
    const { executors } = setup({ mid: explode });
    const logged: object[] = [];
    const g = graph([["a", "src"], ["b", "mid"], ["c", "sink"]], [["a", "b"], ["b", "c"]]);

    const result = await runGraph(g, { executors, ctx, specs, log: (info) => logged.push(info) });

    expect(result.nodes.b).toEqual({ state: "failed", error: "Something went wrong on our side" });
    expect(logged).toEqual([{ node: "b", type: "mid", failure: "Error" }]);
    for (const shown of [result.nodes, result.events, logged]) expect(JSON.stringify(shown)).not.toContain("secret-bytes");
  });

  it("refuses a graph with a loop (callers check first, so this is a programming error)", async () => {
    const { executors } = setup();
    const g = graph([["a", "mid"], ["b", "mid"], ["c", "sink"]], [["a", "b"], ["b", "a"], ["b", "c"]]);
    await expect(runGraph(g, { executors, ctx, specs })).rejects.toThrow(/loop/);
  });
});
