"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { applyToWorkingCopy, setAsset, setTuning } from "@/lib/graph/edits";
import { NODE_SPECS } from "@/lib/graph/registry";
import type { NodeOutcome } from "@/lib/graph/runner";
import type { Assets, Graph, GraphNode, Problem, Tuning } from "@/lib/graph/types";

const MAX_FILE_BYTES = 4 * 1024 * 1024;

// The nodes that take a file from the person, and what the file picker accepts.
const FILE_NODES: Record<string, { accept: string; what: string }> = {
  "reference-image": { accept: ".png,.jpg,.jpeg,image/png,image/jpeg", what: "picture" },
  model: { accept: ".glb,model/gltf-binary", what: "model" },
};

const STATE_WORDS: Record<string, string> = {
  waiting: "waiting",
  running: "running",
  done: "done",
  skipped: "skipped",
  failed: "failed",
  "not-used": "not used",
};

type Played =
  | { kind: "ran"; state: "done" | "failed"; order: string[]; nodes: Record<string, NodeOutcome> }
  | { kind: "invalid"; problems: Problem[] };

const HEX = /^#[0-9a-f]{6}$/i;

function Swatches({ colors }: { colors: string[] }) {
  return (
    <span>
      {colors.map((color) => (
        <span
          key={color}
          title={color}
          style={{ display: "inline-block", width: "1.2em", height: "1.2em", background: color, border: "1px solid #888", marginRight: "0.25em", verticalAlign: "middle" }}
        />
      ))}
      {colors.join(" ")}
    </span>
  );
}

function Outcome({ outcome }: { outcome: NodeOutcome }) {
  const colors = Array.isArray(outcome.result) && outcome.result.every((c) => typeof c === "string" && HEX.test(c)) ? (outcome.result as string[]) : null;
  return (
    <>
      {STATE_WORDS[outcome.state] ?? outcome.state}
      {outcome.error && <span className="error"> {outcome.error}</span>}
      {outcome.because && <span className="note"> {outcome.because}</span>}
      {colors && (
        <>
          {" "}
          <Swatches colors={colors} />
        </>
      )}
    </>
  );
}

interface Props {
  id: string;
  name: string;
  initialGraph: Graph;
  initialAssets: Assets;
  initialRunId: string | null;
}

export function GraphPlain({ id, name, initialGraph, initialAssets, initialRunId }: Props) {
  const router = useRouter();
  const [graph, setGraph] = useState(initialGraph);
  const [assets, setAssets] = useState(initialAssets);
  const [text, setText] = useState(() => JSON.stringify(initialGraph, null, 2));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [played, setPlayed] = useState<Played | null>(null);
  const [runId, setRunId] = useState<string | null>(initialRunId);

  const apiUrl = `/api/graphs/${encodeURIComponent(id)}`;
  const adopt = (next: Graph) => {
    setGraph(next);
    setText(JSON.stringify(next, null, 2));
  };

  // Sends a graph to the server. True when it was saved; otherwise the reason is on the page.
  async function save(toSave: Graph): Promise<boolean> {
    const response = await fetch(apiUrl, { method: "PUT", body: JSON.stringify({ graph: toSave }) });
    if (response.status === 401) {
      router.replace("/sign-in");
      return false;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string; graph?: Graph; assets?: Assets };
    if (!response.ok || !body.graph || !body.assets) {
      setError(body.error ?? "Something went wrong on our side");
      return false;
    }
    setAssets(body.assets);
    adopt(body.graph);
    return true;
  }

  async function choose(node: GraphNode, file: File | undefined) {
    if (!file) return;
    setError("");
    if (file.size > MAX_FILE_BYTES) return setError(`${file.name}: larger than 4 MB`);
    // The choice is made in the JSON box's graph (the working copy), so hand edits there are kept. Checked before the
    // upload, so a file is not sent when its choice cannot be recorded.
    const ready = applyToWorkingCopy(text, (g) => g);
    if (!ready.ok) return setError(ready.error);
    setBusy(true);
    try {
      const uploaded = await fetch(`${apiUrl}/assets?name=${encodeURIComponent(file.name)}`, { method: "POST", body: file });
      if (uploaded.status === 401) return router.replace("/sign-in");
      const info = (await uploaded.json().catch(() => ({}))) as { error?: string; sha256?: string };
      if (!uploaded.ok || !info.sha256) return setError(info.error ?? "The upload did not finish.");
      const chosen = applyToWorkingCopy(text, (g) => setAsset(g, node.id, info.sha256 as string));
      if (!chosen.ok) return setError(chosen.error);
      await save(chosen.graph);
    } catch {
      setError("The upload did not finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function tune(node: GraphNode, field: keyof Tuning, value: string) {
    // Applied to the JSON box's graph, so whatever else was typed there is kept.
    const edited = applyToWorkingCopy(text, (g) => {
      const current = g.nodes.find((n) => n.id === node.id)?.params.tuning as Tuning | undefined;
      return current ? setTuning(g, node.id, { ...current, [field]: Number(value) }) : g;
    });
    if (!edited.ok) return setError(edited.error);
    setError("");
    adopt(edited.graph);
  }

  async function saveText() {
    setError("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return setError("The graph JSON is not valid.");
    }
    setBusy(true);
    try {
      await save(parsed as Graph);
    } catch {
      setError("The request did not finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function play() {
    setError("");
    setPlayed(null);
    let working: unknown;
    try {
      working = JSON.parse(text);
    } catch {
      return setError("The graph JSON is not valid, so it was not played.");
    }
    setBusy(true);
    try {
      if (!(await save(working as Graph))) return; // what is played is what is saved
      const response = await fetch(`${apiUrl}/play`, { method: "POST" });
      if (response.status === 401) return router.replace("/sign-in");
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        problems?: Problem[];
        state?: "done" | "failed";
        order?: string[];
        nodes?: Record<string, NodeOutcome>;
        runId?: string;
      };
      if (response.status === 422) return setPlayed({ kind: "invalid", problems: body.problems ?? [] });
      if (!response.ok || !body.nodes || !body.order || !body.state) return setError(body.error ?? "Something went wrong on our side");

      setPlayed({ kind: "ran", state: body.state, order: body.order, nodes: body.nodes });
      // A new run replaces the old one; if the Preview itself failed, the old run is already gone.
      const previewNode = (working as Graph).nodes.find((n) => n.type === "preview");
      if (body.runId) setRunId(body.runId);
      else if (previewNode && body.nodes[previewNode.id]?.state === "failed") setRunId(null);
    } catch {
      setError("The request did not finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const label = (node: GraphNode) => NODE_SPECS[node.type]?.label ?? node.type;

  return (
    <main className="page">
      <h1>{name}</h1>
      <p className="note">
        A plain page for building and playing a graph. <Link href="/graphs">All graphs</Link>
      </p>

      <h2>Nodes</h2>
      <ul>
        {graph.nodes.map((node) => {
          const file = Object.hasOwn(FILE_NODES, node.type) ? FILE_NODES[node.type] : null;
          const chosen = typeof node.params.asset === "string" && Object.hasOwn(assets, node.params.asset) ? assets[node.params.asset].name : null;
          const tuning = node.type === "game-template" ? (node.params.tuning as Tuning) : null;
          return (
            <li key={node.id}>
              <strong>{label(node)}</strong> <span className="note">({node.id}) {NODE_SPECS[node.type]?.help}</span>
              {file && (
                <div>
                  <label>
                    Choose a {file.what}: <input type="file" accept={file.accept} disabled={busy} onChange={(e) => choose(node, e.target.files?.[0])} />
                  </label>{" "}
                  {chosen ? <span>Chosen: {chosen}</span> : <span className="note">nothing chosen yet</span>}
                </div>
              )}
              {tuning && (
                <div>
                  {(["speed", "jumpHeight", "obstacleSpacing"] as const).map((field) => (
                    <label key={field}>
                      {field}{" "}
                      <input type="number" step="0.1" value={tuning[field]} style={{ width: "5em" }} onChange={(e) => tune(node, field, e.target.value)} />{" "}
                    </label>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <h2>Play</h2>
      <p>
        <button onClick={play} disabled={busy}>
          {busy ? "Working…" : "Save and Play"}
        </button>
        {runId && (
          <>
            {" "}
            <Link href={`/runs/${encodeURIComponent(runId)}/preview`}>Open the Preview</Link>
          </>
        )}
      </p>
      {error && <p className="error" role="alert">{error}</p>}

      {played?.kind === "invalid" && (
        <>
          <p>This graph is not ready to play:</p>
          <ul>
            {played.problems.map((problem, i) => (
              <li key={i} className="error">
                {problem.message}
              </li>
            ))}
          </ul>
        </>
      )}

      {played?.kind === "ran" && (
        <>
          <p>{played.state === "done" ? "The game is ready." : "The game could not be made."} In the order it ran:</p>
          <ol>
            {played.order.map((nodeId) => {
              const node = graph.nodes.find((n) => n.id === nodeId);
              return (
                <li key={nodeId}>
                  {node ? label(node) : nodeId} ({nodeId}): <Outcome outcome={played.nodes[nodeId]} />
                </li>
              );
            })}
          </ol>
          {graph.nodes.some((n) => played.nodes[n.id]?.state === "not-used") && (
            <p className="note">
              Not used (not connected to the Preview):{" "}
              {graph.nodes.filter((n) => played.nodes[n.id]?.state === "not-used").map((n) => `${label(n)} (${n.id})`).join(", ")}
            </p>
          )}
        </>
      )}

      <h2>Graph JSON</h2>
      <p className="note">The working copy. Edit it to wire a model of your own to the hero, then Save (or Save and Play).</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={18} style={{ width: "100%", fontFamily: "var(--font-geist-mono), monospace", fontSize: "0.85em" }} />
      <p>
        <button onClick={saveText} disabled={busy}>
          Save
        </button>
      </p>
    </main>
  );
}
