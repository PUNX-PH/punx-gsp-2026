// The HTTP side of graphs: handlers over the graph service, each taking a Request and returning a Response, so they are
// tested without a server. Every handler goes through the shared guard (origin for changes, a valid session, plain
// failures), and nothing it returns says who owns a graph.
import { json, makeGuard } from "@/lib/api/guard";
import type { AuthPort } from "@/lib/auth/ports";
import { readBodyCapped, TooLargeError } from "@/lib/body";
import type { GraphService } from "@/lib/graph/service";
import { GraphError, type GraphRecord } from "@/lib/graph/types";

const MAX_GRAPH_BODY_BYTES = 64 * 1024;
const MAX_CREATE_BODY_BYTES = 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

export interface GraphApiDeps {
  auth: AuthPort;
  graphs: GraphService;
  domain: string;
}

// What the pages need to know about a graph: never the owner.
const publicGraph = (r: GraphRecord) => ({
  id: r.id,
  name: r.name,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
  graph: r.graph,
  assets: r.assets,
  lastRunId: r.lastRunId,
});
const summary = (r: GraphRecord) => ({ id: r.id, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt, lastRunId: r.lastRunId });

type Body = { ok: true; value: unknown } | { ok: false; response: Response };

// A JSON body read with a hard size cap. An empty body is `undefined`, not an error.
async function readJson(req: Request, maxBytes: number, tooLarge: string, notJson: string): Promise<Body> {
  let bytes: Uint8Array;
  try {
    bytes = await readBodyCapped(req, maxBytes);
  } catch (error) {
    if (error instanceof TooLargeError) return { ok: false, response: json(413, { error: tooLarge }) };
    throw error;
  }
  if (bytes.length === 0) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch {
    return { ok: false, response: json(400, { error: notJson }) };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function makeGraphApi({ auth, graphs, domain }: GraphApiDeps) {
  const guarded = makeGuard({
    auth,
    domain,
    label: "graph API",
    idName: "graphId",
    publicError: (error) => (error instanceof GraphError ? { status: error.status, message: error.message } : null),
  });

  return {
    listGraphs: (req: Request) =>
      guarded(req, "listGraphs", { changes: false }, async (user) => json(200, { graphs: (await graphs.listGraphs(user)).map(summary) })),

    createGraph: (req: Request) =>
      guarded(req, "createGraph", { changes: true }, async (user) => {
        const body = await readJson(req, MAX_CREATE_BODY_BYTES, "The request is too large.", "The request is not valid JSON.");
        if (!body.ok) return body.response;
        const input = body.value ?? {};
        if (!isObject(input) || (input.name !== undefined && typeof input.name !== "string") || (input.starter !== undefined && typeof input.starter !== "boolean")) {
          return json(400, { error: "Send { name?: text, starter?: true or false } as JSON." });
        }
        return json(201, publicGraph(await graphs.createGraph(user, { name: input.name as string | undefined, starter: input.starter as boolean | undefined })));
      }),

    getGraph: (req: Request, id: string) =>
      guarded(req, "getGraph", { changes: false, id }, async (user) => json(200, publicGraph(await graphs.getGraph(user, id)))),

    saveGraph: (req: Request, id: string) =>
      guarded(req, "saveGraph", { changes: true, id }, async (user) => {
        const body = await readJson(req, MAX_GRAPH_BODY_BYTES, "The graph is larger than 64 KB", "The graph is not valid JSON.");
        if (!body.ok) return body.response;
        if (!isObject(body.value) || (body.value.name !== undefined && typeof body.value.name !== "string")) {
          return json(400, { error: "Send { name?: text, graph: the graph } as JSON." });
        }
        return json(200, publicGraph(await graphs.saveGraph(user, id, { name: body.value.name as string | undefined, graph: body.value.graph })));
      }),

    deleteGraph: (req: Request, id: string) =>
      guarded(req, "deleteGraph", { changes: true, id }, async (user) => {
        await graphs.deleteGraph(user, id);
        return new Response(null, { status: 204 });
      }),

    addAsset: (req: Request, id: string) =>
      guarded(req, "addAsset", { changes: true, id }, async (user) => {
        const name = new URL(req.url).searchParams.get("name") || "file";
        let bytes: Uint8Array;
        try {
          bytes = await readBodyCapped(req, MAX_FILE_BYTES);
        } catch (error) {
          if (error instanceof TooLargeError) return json(413, { error: `${name}: larger than 4 MB` });
          throw error;
        }
        const { sha256, name: shown, size, kind, width, height } = await graphs.addAsset(user, id, name, bytes);
        return json(201, { sha256, name: shown, size, kind, width, height });
      }),

    getAsset: (req: Request, id: string, sha256: string) =>
      guarded(req, "getAsset", { changes: false, id }, async (user) => {
        const { bytes, contentType } = await graphs.readAsset(user, id, sha256);
        return new Response(bytes as BodyInit, {
          status: 200,
          headers: { "Content-Type": contentType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private" },
        });
      }),

    play: (req: Request, id: string) =>
      guarded(req, "play", { changes: true, id }, async (user) => {
        const played = await graphs.play(user, id);
        if (played.kind === "invalid") return json(422, { problems: played.problems });
        const { state, order, nodes } = played.result;
        return json(200, { state, order, nodes, runId: played.runId });
      }),
  };
}
