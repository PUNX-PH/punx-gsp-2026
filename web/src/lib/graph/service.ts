// The graph service: the rules about graphs and their files, over two ports (records and files) so that it is tested
// with in-memory fakes. Everything about who may see a graph is decided here: a graph that is not yours, does not
// exist, or has no such file all look the same ("Not found"). A graph is saved as a whole after it parses; a half-built
// graph can always be saved (what stops a run is checked at Play).
import type { DescribeGameService } from "@/lib/ai/types";
import type { BlenderService } from "@/lib/blender/types";
import type { User } from "@/lib/auth/ports";
import { checkGlb } from "@/lib/glb";
import { checkGraph } from "@/lib/graph/checks";
import { readImage, sniffKind } from "@/lib/graph/image";
import { checkFbx } from "@/lib/modelFiles";
import { EXECUTORS } from "@/lib/graph/nodes";
import { PLAY_BUDGET_MS } from "@/lib/graph/playTime";
import { NODE_SPECS, WIRE_WORDS } from "@/lib/graph/registry";
import { type RunResult, runGraph } from "@/lib/graph/runner";
import { parseGraph } from "@/lib/graph/schema";
import { describedStarterGraph, starterGraph } from "@/lib/graph/starter";
import type { GraphFiles, GraphRecords } from "@/lib/graph/store/ports";
import {
  type AssetInfo,
  type Executor,
  type ExecutorContext,
  type Graph,
  GraphError,
  type GraphRecord,
  NodeError,
  type Problem,
} from "@/lib/graph/types";
import { randomId, sha256Hex } from "@/lib/runs/service";
import { RunError, type RunService } from "@/lib/runs/types";

const MAX_GRAPHS_PER_PERSON = 10;
const MAX_ASSETS_PER_GRAPH = 20;
const UNREFERENCED_GRACE_MS = 5 * 60 * 1000;
const MAX_NAME = 80;
const MAX_FILE_NAME = 100;
const DEFAULT_NAME = "Untitled game";
// What a graph id looks like (ours are 22 URL-safe characters); anything else is not a graph and is never passed on.
const GRAPH_ID = /^(?!__)[A-Za-z0-9_-]{1,64}$/;
// The kind of file each file-taking node accepts.
const FILE_KIND: Record<string, AssetInfo["kind"]> = { "reference-image": "image", model: "model" };

/** Play either says what stops the graph from running, or runs it (which can still fail on a node). */
export type PlayResult = { kind: "invalid"; problems: Problem[] } | { kind: "ran"; result: RunResult; runId?: string };

export interface GraphService {
  /** `starter: true` is the picture-and-palette starter, `"described"` the Describe a game one, anything else an empty graph. */
  createGraph(user: User, input: { name?: string; starter?: boolean | "described" }): Promise<GraphRecord>;
  listGraphs(user: User): Promise<GraphRecord[]>;
  getGraph(user: User, id: string): Promise<GraphRecord>;
  saveGraph(user: User, id: string, input: { name?: string; graph: unknown }): Promise<GraphRecord>;
  deleteGraph(user: User, id: string): Promise<void>;
  addAsset(user: User, id: string, name: string, bytes: Uint8Array): Promise<{ sha256: string } & AssetInfo>;
  readAsset(user: User, id: string, sha256: string): Promise<{ bytes: Uint8Array; contentType: string }>;
  /** Checks the SAVED graph, runs it, and keeps the graph's one run. */
  play(user: User, id: string): Promise<PlayResult>;
}

export interface GraphServiceDeps {
  records: GraphRecords;
  files: GraphFiles;
  runs: RunService;
  now: () => number;
  newId?: () => string;
  executors?: Record<string, Executor>;
  /** Describe Game's service. Without one, a graph that uses Describe Game fails that step plainly. */
  ai?: DescribeGameService;
  /** Prepare Model and Make Shape. Without one, a graph that uses them fails those steps plainly. */
  blender?: BlenderService;
}

// What Describe Game gets when no AI service is wired (a deployment without the key): the step fails in plain words, nothing else does.
const noAi: DescribeGameService = {
  async describe() {
    throw new NodeError("Describe Game: The AI service did not answer. Try again.");
  },
};

// What the Blender steps get when no service is wired (a deployment without the worker): they fail in plain words, nothing else does.
const noBlender: BlenderService = {
  async prepare() {
    throw new NodeError("Prepare Model: The Blender service did not answer. Try again.");
  },
  async shape() {
    throw new NodeError("Make Shape: The Blender service did not answer. Try again.");
  },
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

const withoutControls = (text: string) => text.replace(/\p{Cc}/gu, "");

function cleanName(name: string | undefined): string {
  const cleaned = withoutControls(name ?? "").trim().slice(0, MAX_NAME).trim();
  return cleaned === "" ? DEFAULT_NAME : cleaned;
}

// A file name is for people to read and is never used in a path; this keeps it short and free of oddities anyway.
function cleanFileName(name: string): string {
  const cleaned = withoutControls(name).replace(/[/\\]/g, "_").trim().slice(0, MAX_FILE_NAME).trim();
  return cleaned === "" ? "file" : cleaned;
}

export function makeGraphService(deps: GraphServiceDeps): GraphService {
  const { records, files, runs, now } = deps;
  const newId = deps.newId ?? randomId;
  const notFound = () => new GraphError(404, "Not found");

  async function ownedGraph(user: User, id: string): Promise<GraphRecord> {
    if (!GRAPH_ID.test(id)) throw notFound();
    const record = await records.get(id);
    if (!record || record.ownerUid !== user.uid) throw notFound();
    return record;
  }

  const referencedFiles = (graph: Graph) =>
    new Set(graph.nodes.flatMap((n) => (typeof n.params.asset === "string" ? [n.params.asset] : [])));

  // Files nothing refers to, uploaded more than five minutes ago. (A file is uploaded before the graph that uses it is
  // saved, so a fresh one is never stale.)
  const staleFiles = (record: GraphRecord) => {
    const used = referencedFiles(record.graph);
    return Object.entries(record.assets)
      .filter(([sha, info]) => !used.has(sha) && now() - info.uploadedAt > UNREFERENCED_GRACE_MS)
      .map(([sha]) => sha);
  };

  async function removeFiles(record: GraphRecord, shas: string[]): Promise<GraphRecord> {
    if (shas.length === 0) return record;
    const updated = await records.update(record.id, { removeAssets: shas, updatedAt: now() });
    for (const sha of shas) await files.delete(record.id, sha);
    return updated;
  }

  return {
    async createGraph(user, input) {
      const existing = await records.listByOwner(user.uid);
      if (existing.length >= MAX_GRAPHS_PER_PERSON) throw new GraphError(409, `You have ${MAX_GRAPHS_PER_PERSON} graphs. Delete one first.`);

      const record: GraphRecord = {
        id: newId(),
        ownerUid: user.uid,
        ownerEmail: user.email,
        name: cleanName(input.name),
        createdAt: now(),
        updatedAt: now(),
        graph: input.starter === "described" ? describedStarterGraph() : input.starter ? starterGraph() : { schemaVersion: 1, nodes: [], edges: [] },
        assets: {},
        lastRunId: null,
      };
      await records.create(record);
      return record;
    },

    async listGraphs(user) {
      return (await records.listByOwner(user.uid)).sort((a, b) => b.updatedAt - a.updatedAt);
    },

    getGraph: ownedGraph,

    async saveGraph(user, id, input) {
      const record = await ownedGraph(user, id);
      const parsed = parseGraph(input.graph);
      if (!parsed.ok) throw new GraphError(400, parsed.error);

      for (const node of parsed.graph.nodes) {
        const sha = node.params.asset;
        if (typeof sha !== "string") continue;
        const label = NODE_SPECS[node.type].label;
        if (!Object.hasOwn(record.assets, sha)) throw new GraphError(400, `${label}: that file was not uploaded to this graph.`);
        const wanted = FILE_KIND[node.type];
        if (record.assets[sha].kind !== wanted) {
          throw new GraphError(400, `${label}: the file you chose is not a ${wanted === "image" ? WIRE_WORDS.image : "3D model"}.`);
        }
      }

      const stale = staleFiles({ ...record, graph: parsed.graph });
      const updated = await records.update(id, {
        name: input.name === undefined ? undefined : cleanName(input.name),
        graph: parsed.graph,
        removeAssets: stale,
        updatedAt: now(),
      });
      for (const sha of stale) await files.delete(id, sha);
      return updated;
    },

    async deleteGraph(user, id) {
      const record = await ownedGraph(user, id);
      if (record.lastRunId) {
        try {
          await runs.deleteRun(user, record.lastRunId);
        } catch (error) {
          if (!(error instanceof RunError && error.status === 404)) throw error; // someone may have deleted it already
        }
      }
      await files.deleteGraph(id);
      await records.delete(id);
    },

    async addAsset(user, id, name, bytes) {
      let record = await ownedGraph(user, id);
      const shown = cleanFileName(name);

      // What the file is comes from its bytes, never from its name or the type the browser claimed.
      const kind = sniffKind(bytes);
      let info: Omit<AssetInfo, "uploadedAt">;
      if (kind === "png" || kind === "jpeg") {
        const image = await readImage(bytes);
        if (!image.ok) throw new GraphError(400, `${shown}: ${image.error}`);
        info = { name: shown, size: bytes.length, kind: "image", contentType: kind === "png" ? "image/png" : "image/jpeg", width: image.width, height: image.height };
      } else if (kind === "glb") {
        const checked = checkGlb(shown, bytes);
        if (!checked.ok) throw new GraphError(400, checked.error);
        info = { name: shown, size: bytes.length, kind: "model", format: "glb", contentType: "model/gltf-binary" };
      } else if (kind === "fbx") {
        const checked = checkFbx(shown, bytes);
        if (!checked.ok) throw new GraphError(400, checked.error);
        info = { name: shown, size: bytes.length, kind: "model", format: "fbx", contentType: "application/octet-stream" };
      } else if (kind === "obj") {
        // sniffKind only says "obj" for text that already reads as one: nothing more to check here.
        info = { name: shown, size: bytes.length, kind: "model", format: "obj", contentType: "text/plain" };
      } else {
        throw new GraphError(400, `${shown}: not a PNG, JPEG, GLB, FBX or OBJ file`);
      }

      const sha256 = await sha256Hex(bytes);
      if (Object.hasOwn(record.assets, sha256)) return { sha256, ...record.assets[sha256] };

      if (Object.keys(record.assets).length >= MAX_ASSETS_PER_GRAPH) record = await removeFiles(record, staleFiles(record));

      // The file goes in first, so that a record never points at nothing; if the record is refused the file is removed.
      await files.put(id, sha256, bytes, info.contentType);
      try {
        const updated = await records.addAsset(id, sha256, { ...info, uploadedAt: now() }, MAX_ASSETS_PER_GRAPH);
        return { sha256, ...updated.assets[sha256] };
      } catch (error) {
        await files.delete(id, sha256);
        throw error;
      }
    },

    async readAsset(user, id, sha256) {
      const record = await ownedGraph(user, id);
      if (!Object.hasOwn(record.assets, sha256)) throw notFound(); // not record.assets[sha256]: "constructor" is truthy there
      const bytes = await files.get(id, sha256);
      if (!bytes) throw notFound();
      return { bytes, contentType: record.assets[sha256].contentType };
    },

    async play(user, id) {
      const record = await ownedGraph(user, id);
      const parsed = parseGraph(record.graph);
      if (!parsed.ok) throw new Error("a stored graph no longer parses"); // saved graphs always parse: our fault, a logged 500
      const problems = checkGraph(parsed.graph, record.assets);
      if (problems.length > 0) return { kind: "invalid", problems };

      // The Preview replaces the graph's earlier run; the holder tells us afterwards whether the run changed.
      let lastRun = record.lastRunId;
      // Files steps make (Blender's results) live in the graph's folder beside its uploads. A step can read one only after this Play
      // has stored it or found it there again, so a hash is never a way to reach another graph's files.
      const made = new Set<string>();
      const ctx: ExecutorContext = {
        user,
        graphId: id,
        assets: record.assets,
        readAsset: async (sha256) => (Object.hasOwn(record.assets, sha256) || made.has(sha256) ? files.get(id, sha256) : null),
        derived: {
          async put(bytes) {
            const sha256 = await sha256Hex(bytes);
            await files.put(id, sha256, bytes, "model/gltf-binary");
            made.add(sha256);
            return sha256;
          },
          async recall(sha256) {
            if (!SHA256_HEX.test(sha256) || !(await files.get(id, sha256))) return false;
            made.add(sha256);
            return true;
          },
        },
        deadline: now() + PLAY_BUDGET_MS,
        blender: deps.blender ?? noBlender,
        runs,
        lastRun: { get: () => lastRun, set: (runId) => void (lastRun = runId) },
        ai: deps.ai ?? noAi,
      };
      // An unexpected failure is logged with the graph, the node and the kind of failure, never a message or file contents.
      const log = (info: object) => console.error("graph node failed", { graphId: id, ...info });
      const result = await runGraph(parsed.graph, { executors: deps.executors ?? EXECUTORS, ctx, log });
      if (lastRun !== record.lastRunId) await records.setLastRunId(id, lastRun);

      const finalNode = parsed.graph.nodes.find((n) => NODE_SPECS[n.type].final)!;
      const runId = (result.nodes[finalNode.id].result as { runId?: string } | undefined)?.runId;
      return { kind: "ran", result, runId };
    },
  };
}
