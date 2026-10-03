// What the "Add step" menu offers: every step type, or, from an open output, only the steps that accept that wire. A
// step that cannot be added (one Preview, 50 steps) is listed but greyed, with the reason.
import { addProblem } from "@/lib/graph/edits";
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Graph, PortRef, WireType } from "@/lib/graph/types";

export interface Choice {
  type: string;
  label: string;
  help: string;
  disabledReason?: string;
  /** From an open output: the input of the new step the wire goes into (the first one of that wire type). */
  wireInto?: string;
}

export function addChoices(graph: Graph, from?: PortRef, specs: Record<string, NodeSpec> = NODE_SPECS): Choice[] {
  let wire: WireType | null = null;
  if (from) {
    const source = graph.nodes.find((n) => n.id === from.node);
    const output = source ? specs[source.type]?.outputs.find((p) => p.name === from.port) : undefined;
    if (!output) return [];
    wire = output.type;
  }

  const choices: Choice[] = [];
  for (const spec of Object.values(specs)) {
    let wireInto: string | undefined;
    if (wire) {
      const input = spec.inputs.find((p) => p.type === wire);
      if (!input) continue;
      wireInto = input.name;
    }
    const disabledReason = addProblem(graph, spec.type, specs);
    choices.push({ type: spec.type, label: spec.label, help: spec.help, ...(disabledReason ? { disabledReason } : {}), ...(wireInto ? { wireInto } : {}) });
  }
  return choices;
}
