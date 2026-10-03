// Runs a checked graph: only the nodes that lead to the Preview, one at a time, in a stable order. A node that fails
// is reported on itself and everything that depends on it is skipped; other branches finish. Progress is reported
// as events through a callback, so a transport (streaming, polling) can be added later without touching this.
import { describeFailure } from "@/lib/auth/errors";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import { type Executor, type ExecutorContext, type Graph, NodeError, type WireValue } from "@/lib/graph/types";
import { ancestors, orderNodes } from "@/lib/graph/walk";

export type NodeState = "waiting" | "running" | "done" | "skipped" | "failed" | "not-used";

export type RunEvent =
  | { type: "node-started"; node: string }
  | { type: "node-done"; node: string; result: unknown }
  | { type: "node-failed"; node: string; error: string }
  | { type: "node-skipped"; node: string; because: string }
  | { type: "run-done"; state: "done" | "failed" };

export interface NodeOutcome {
  state: NodeState;
  result?: unknown;
  error?: string;
  because?: string;
}

export interface RunResult {
  state: "done" | "failed";
  /** The nodes that were to run, in the order they were taken. */
  order: string[];
  nodes: Record<string, NodeOutcome>;
  events: RunEvent[];
}

export interface RunDeps {
  executors: Record<string, Executor>;
  ctx: ExecutorContext;
  specs?: Record<string, NodeSpec>;
  /** Where unexpected failures are logged (the node and the kind of failure, never a message). */
  log?: (info: object) => void;
}

const UNEXPECTED = "Something went wrong on our side";

export async function runGraph(graph: Graph, deps: RunDeps, onEvent: (event: RunEvent) => void = () => {}): Promise<RunResult> {
  const specs = deps.specs ?? NODE_SPECS;
  const log = deps.log ?? ((info: object) => console.error("graph node failed", info));

  const nodes = new Map(graph.nodes.map((n) => [n.id, n]));
  const finals = graph.nodes.filter((n) => specs[n.type].final).map((n) => n.id);
  const planned = orderNodes(graph, ancestors(graph, finals));
  if (!planned.ok) throw new Error("runGraph was given a graph with a loop; check the graph first");

  const events: RunEvent[] = [];
  const emit = (event: RunEvent) => {
    events.push(event);
    onEvent(event);
  };

  const outcomes = new Map<string, NodeOutcome>();
  const outputs = new Map<string, WireValue | undefined>();

  for (const id of planned.order) {
    const node = nodes.get(id)!;
    const incoming = graph.edges.filter((e) => e.to.node === id);

    // A source that failed or was skipped means this node cannot run, whether or not the input is optional.
    const broken = incoming.map((e) => e.from.node).find((from) => ["failed", "skipped"].includes(outcomes.get(from)?.state ?? ""));
    if (broken !== undefined) {
      const because = `Skipped because ${specs[nodes.get(broken)!.type].label} failed.`;
      outcomes.set(id, { state: "skipped", because });
      emit({ type: "node-skipped", node: id, because });
      continue;
    }

    const inputs = Object.fromEntries(
      incoming.flatMap((e) => {
        const value = outputs.get(e.from.node);
        return value === undefined ? [] : [[e.to.port, value] as const];
      }),
    ) as Partial<Record<string, WireValue>>;

    if (!Object.hasOwn(deps.executors, node.type)) throw new Error(`no executor for node type ${node.type}`);
    emit({ type: "node-started", node: id });
    try {
      const { output, result } = await deps.executors[node.type](inputs, node.params, deps.ctx);
      outputs.set(id, output);
      outcomes.set(id, { state: "done", result });
      emit({ type: "node-done", node: id, result });
    } catch (error) {
      let message = UNEXPECTED;
      if (error instanceof NodeError) message = error.message;
      else log({ node: id, type: node.type, failure: describeFailure(error) });
      outcomes.set(id, { state: "failed", error: message });
      emit({ type: "node-failed", node: id, error: message });
    }
  }

  const state = planned.order.every((id) => outcomes.get(id)?.state === "done") ? "done" : "failed";
  emit({ type: "run-done", state });

  return {
    state,
    order: planned.order,
    nodes: Object.fromEntries(graph.nodes.map((n) => [n.id, outcomes.get(n.id) ?? { state: "not-used" as const }])),
    events,
  };
}
