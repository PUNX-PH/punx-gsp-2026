// Reading a graph that came from outside (a request body, a stored record). Strict: known keys only, finite numbers,
// ids that cannot clash with object internals, and wires that join an output to an input of the same type. The parser
// never looks anything up by a key it was given, and returns a fresh copy built from known keys. What it does NOT
// require is a finished graph: a half-built one can always be saved; checks.ts says what stops a run.
import { NODE_SPECS, type NodeSpec } from "@/lib/graph/registry";
import type { Graph, GraphEdge, GraphNode, PortRef } from "@/lib/graph/types";
import { wiringProblem } from "@/lib/graph/wiring";

export const MAX_NODES = 50;
export const MAX_EDGES = 200;

const NODE_ID = /^[A-Za-z0-9_-]{1,32}$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

export type ParseResult = { ok: true; graph: Graph } | { ok: false; error: string };

class Refusal extends Error {}
const refuse = (message: string): never => {
  throw new Refusal(message);
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const quoted = (value: unknown) => (typeof value === "string" ? `"${value}"` : JSON.stringify(value) ?? "that");

function onlyKeys(object: Record<string, unknown>, allowed: string[], what: string): void {
  for (const key of Object.keys(object)) if (!allowed.includes(key)) refuse(`${what} has an unknown key "${key}".`);
}

export function parseGraph(input: unknown, specs: Record<string, NodeSpec> = NODE_SPECS): ParseResult {
  try {
    return { ok: true, graph: parse(input, specs) };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
}

function parse(input: unknown, specs: Record<string, NodeSpec>): Graph {
  if (!isObject(input)) return refuse("The graph is not a JSON object.");
  onlyKeys(input, ["schemaVersion", "nodes", "edges"], "The graph");
  if (input.schemaVersion !== 1) refuse("The graph's schemaVersion must be 1.");
  if (!Array.isArray(input.nodes)) refuse("The graph's nodes must be a list.");
  if (!Array.isArray(input.edges)) refuse("The graph's wires (edges) must be a list.");
  const rawNodes = input.nodes as unknown[];
  const rawEdges = input.edges as unknown[];
  if (rawNodes.length > MAX_NODES) refuse(`A graph can have at most ${MAX_NODES} nodes.`);
  if (rawEdges.length > MAX_EDGES) refuse(`A graph can have at most ${MAX_EDGES} wires.`);

  const nodes = rawNodes.map((raw) => parseNode(raw, specs));
  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) refuse(`Two nodes share the id "${node.id}".`);
    byId.set(node.id, node);
  }

  const edges = rawEdges.map((raw) => parseEdge(raw));
  const accepted: GraphEdge[] = [];
  for (const edge of edges) {
    const problem = wiringProblem(nodes, accepted, edge, specs);
    if (problem) refuse(problem);
    accepted.push(edge);
  }

  return { schemaVersion: 1, nodes, edges };
}

function parseNode(raw: unknown, specs: Record<string, NodeSpec>): GraphNode {
  if (!isObject(raw)) return refuse("Every node must be an object.");
  onlyKeys(raw, ["id", "type", "params", "position"], `Node ${quoted(raw.id)}`);

  const { id, type, params, position } = raw;
  if (typeof id !== "string" || !NODE_ID.test(id)) {
    return refuse(`Node id ${quoted(id)} is not allowed (letters, digits, - and _, 1 to 32 characters).`);
  }
  if (RESERVED_IDS.has(id)) refuse(`Node id "${id}" is reserved.`);
  if (typeof type !== "string" || !Object.hasOwn(specs, type)) refuse(`Node ${id}: unknown node type ${quoted(type)}.`);
  const spec = specs[type as string];

  if (
    !isObject(position) ||
    Object.keys(position).length !== 2 ||
    typeof position.x !== "number" ||
    typeof position.y !== "number" ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    refuse(`Node ${id}: position must be two finite numbers (x and y).`);
  }
  const at = position as { x: number; y: number };

  if (!isObject(params)) refuse(`Node ${id} (${spec.label}): its settings must be an object.`);
  const problem = spec.shapeProblem(params as Record<string, unknown>);
  if (problem) refuse(`Node ${id} (${spec.label}): ${problem}`);

  return { id, type: type as string, params: structuredClone(params) as Record<string, unknown>, position: { x: at.x, y: at.y } };
}

function parseEnd(raw: unknown): PortRef {
  if (!isObject(raw)) return refuse("A wire must have a start and an end.");
  onlyKeys(raw, ["node", "port"], "A wire end");
  if (typeof raw.node !== "string" || typeof raw.port !== "string") return refuse("A wire must name a node and a port at each end.");
  return { node: raw.node, port: raw.port };
}

function parseEdge(raw: unknown): GraphEdge {
  if (!isObject(raw)) return refuse("Every wire must be an object.");
  onlyKeys(raw, ["from", "to"], "A wire");
  return { from: parseEnd(raw.from), to: parseEnd(raw.to) };
}
