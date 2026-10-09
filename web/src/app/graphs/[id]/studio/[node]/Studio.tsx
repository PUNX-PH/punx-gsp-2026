"use client";

// The studio window: one Build Model or Build Environment step, opened large. The person describes the thing in detail on the left, presses Build, and the
// result is drawn on the right as a 3D render they can turn and zoom, with the animations to play and what the build came to. The step stays a step of the
// game's graph: Build saves its settings to the graph and runs just that step, so what is made here is what the game uses.
import Link from "next/link";
import { createElement, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "./studio.module.css";
import shell from "@/app/shell.module.css";
import { KIND_NAMES, MODEL_KINDS, QUALITIES } from "@/lib/builder/kinds";
import { MAX_DESCRIPTION_CHARACTERS, MAX_MOTION_CHARACTERS, MAX_THEME_CHARACTERS } from "@/lib/graph/registry";
import type { Graph } from "@/lib/graph/types";
import { DENSITIES } from "@/lib/settings";

type Params = Record<string, unknown>;
type Phase = "idle" | "saving" | "building" | "done" | "failed";

interface Built {
  sha256?: string;
  kind?: string;
  parts?: number;
  triangles?: number;
  size?: number;
  clips?: string[];
  summary?: string;
  skipped?: unknown[];
  reused?: boolean;
  quality?: string;
  pieces?: { name: string; sha256: string }[];
  scenery?: string[];
  density?: string;
  sky?: string;
  field?: string;
  stripe?: string;
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const kb = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

export function Studio({ graphId, graphName, graph, nodeId }: { graphId: string; graphName: string; graph: Graph; nodeId: string }) {
  const router = useRouter();
  const node = graph.nodes.find((n) => n.id === nodeId)!;
  const isModel = node.type === "build-model";
  const [params, setParams] = useState<Params>(node.params);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [built, setBuilt] = useState<Built | null>(null);
  const [piece, setPiece] = useState(0);

  const set = (patch: Params) => setParams((current) => ({ ...current, ...patch }));
  const busy = phase === "saving" || phase === "building";
  const nothingToBuild = isModel ? (text(params.kind, "auto") === "auto" || text(params.kind) === "freeform") && text(params.description).trim() === "" : false;

  async function build() {
    setError("");
    setPhase("saving");
    try {
      // What is built is what is saved: the step's settings go to the graph first, then just that step runs.
      const next: Graph = { ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, params } : n)) };
      const saved = await fetch(`/api/graphs/${encodeURIComponent(graphId)}`, { method: "PUT", body: JSON.stringify({ graph: next }) });
      if (saved.status === 401) return router.replace("/sign-in");
      if (!saved.ok) {
        const body = (await saved.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "The settings could not be saved.");
      }
      setPhase("building");
      const response = await fetch(`/api/graphs/${encodeURIComponent(graphId)}/step?node=${encodeURIComponent(nodeId)}`, { method: "POST" });
      if (response.status === 401) return router.replace("/sign-in");
      const body = (await response.json().catch(() => ({}))) as { error?: string; nodes?: Record<string, { state: string; result?: Built; error?: string }> };
      if (!response.ok) throw new Error(body.error ?? "The build did not finish. Try again.");
      const outcome = body.nodes?.[nodeId];
      if (!outcome || outcome.state !== "done") throw new Error(outcome?.error ?? (outcome?.state === "skipped" ? "A step before this one failed." : "The build did not finish. Try again."));
      setBuilt(outcome.result ?? {});
      setPiece(0);
      setPhase("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The build did not finish. Try again.");
      setPhase("failed");
    }
  }

  const files = isModel ? (built?.sha256 ? [{ name: text(params.role, "model"), sha256: built.sha256 }] : []) : (built?.pieces ?? []);
  const shown = files[Math.min(piece, Math.max(0, files.length - 1))];

  return (
    <main className={styles.studio}>
      <header className={styles.top}>
        <div>
          <Link href={`/graphs/${encodeURIComponent(graphId)}`} className={shell.link}>
            Back to {graphName}
          </Link>
          <h1 className={shell.title}>{isModel ? "Model studio" : "Environment studio"}</h1>
        </div>
      </header>

      <div className={styles.layout}>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && !nothingToBuild) void build();
          }}
        >
          {isModel ? (
            <>
              <div className={shell.field}>
                <label htmlFor="description">What it looks like</label>
                <textarea
                  id="description"
                  className={`${shell.input} ${styles.long}`}
                  rows={6}
                  maxLength={MAX_DESCRIPTION_CHARACTERS}
                  value={text(params.description)}
                  onChange={(event) => set({ description: event.target.value })}
                  placeholder="A small red fox with a bushy tail, big ears and a white chest."
                />
                <span className={shell.hint}>
                  {MAX_DESCRIPTION_CHARACTERS - Array.from(text(params.description)).length} characters left. Shape, parts, colors and size all help.
                </span>
              </div>
              <div className={styles.pair}>
                <div className={shell.field}>
                  <label htmlFor="kind">Body</label>
                  <select id="kind" className={shell.input} value={text(params.kind, "auto")} onChange={(event) => set({ kind: event.target.value })}>
                    <option value="auto">Let the AI choose</option>
                    {MODEL_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {KIND_NAMES[kind]}
                      </option>
                    ))}
                    <option value="freeform">Custom (made of parts, no animation yet)</option>
                  </select>
                </div>
                <div className={shell.field}>
                  <label htmlFor="role">Role in the game</label>
                  <select id="role" className={shell.input} value={text(params.role, "hero")} onChange={(event) => set({ role: event.target.value })}>
                    <option value="hero">Hero</option>
                    <option value="obstacle">Obstacle</option>
                    <option value="collectible">Collectible</option>
                  </select>
                </div>
              </div>
              <details className={styles.more}>
                <summary>How it moves</summary>
                {(
                  [
                    ["run", "Running"],
                    ["jump", "Jumping"],
                    ["loop", "Idle or spinning"],
                  ] as const
                ).map(([key, label]) => (
                  <div className={shell.field} key={key}>
                    <label htmlFor={key}>{label}</label>
                    <textarea
                      id={key}
                      className={shell.input}
                      rows={2}
                      maxLength={MAX_MOTION_CHARACTERS}
                      value={text(params[key])}
                      onChange={(event) => set({ [key]: event.target.value })}
                      placeholder="Leave empty for the usual motion."
                    />
                  </div>
                ))}
              </details>
            </>
          ) : (
            <>
              <div className={shell.field}>
                <label htmlFor="theme">The world</label>
                <textarea
                  id="theme"
                  className={`${shell.input} ${styles.long}`}
                  rows={5}
                  maxLength={MAX_THEME_CHARACTERS}
                  value={text(params.theme)}
                  onChange={(event) => set({ theme: event.target.value })}
                  placeholder="A snowy pine forest at dusk, with frozen rocks and a few lamps."
                />
                <span className={shell.hint}>{MAX_THEME_CHARACTERS - Array.from(text(params.theme)).length} characters left. Leave it empty for a meadow.</span>
              </div>
              <Choice label="How much scenery" value={text(params.density, "some")} options={DENSITIES.map((d) => [d, d === "few" ? "A little" : d === "some" ? "Some" : "A lot"])} onPick={(density) => set({ density })} />
            </>
          )}

          <Choice
            label="Detail"
            value={text(params.quality, "standard")}
            options={QUALITIES.map((q) => [q, q === "high" ? "High: lit, for a computer" : "Standard: flat colors"])}
            onPick={(quality) => set({ quality })}
          />

          <div className={shell.actions}>
            <button type="submit" className={shell.cta} disabled={busy || nothingToBuild}>
              {phase === "saving" ? "Saving…" : phase === "building" ? "Building…" : built ? "Build again" : "Build"}
            </button>
            {nothingToBuild && <span className={shell.hint}>Describe it, or pick a body.</span>}
          </div>
          <p className={shell.hint} role="status" aria-live="polite">
            {phase === "building" ? "The AI writes the recipe and Blender builds it. This takes up to a minute." : ""}
          </p>
          {error && (
            <p className={shell.error} role="alert">
              {error}
            </p>
          )}
        </form>

        <section className={styles.stage} aria-label="Render">
          {shown ? (
            <>
              <Viewer key={shown.sha256} graphId={graphId} sha256={shown.sha256} clips={isModel ? (built?.clips ?? []) : []} />
              {!isModel && files.length > 1 && (
                <ul className={styles.tabs}>
                  {files.map((file, i) => (
                    <li key={file.sha256 + file.name}>
                      <button type="button" className={styles.tab} aria-pressed={i === piece} onClick={() => setPiece(i)}>
                        {file.name}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <Facts built={built!} isModel={isModel} />
            </>
          ) : (
            <div className={styles.waiting}>
              <strong>{busy ? "Building…" : "Nothing built yet"}</strong>
              <span>{busy ? "The render appears here when it is done." : "Describe it on the left and press Build. The render appears here, and you can turn it around."}</span>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Choice({ label, value, options, onPick }: { label: string; value: string; options: (readonly [string, string])[]; onPick: (value: string) => void }) {
  return (
    <div className={shell.field} role="group" aria-label={label}>
      <span className={styles.label}>{label}</span>
      <ul className={styles.choices}>
        {options.map(([key, name]) => (
          <li key={key}>
            <button type="button" className={styles.choice} aria-pressed={value === key} onClick={() => onPick(key)}>
              {name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Facts({ built, isModel }: { built: Built; isModel: boolean }) {
  const lines: string[] = [];
  if (isModel) {
    if (typeof built.triangles === "number") lines.push(`${built.triangles.toLocaleString("en-US")} triangles`);
    if (typeof built.parts === "number") lines.push(`${built.parts} parts`);
  } else if (Array.isArray(built.scenery)) {
    lines.push(`${built.scenery.length} pieces of scenery`);
  }
  if (typeof built.size === "number") lines.push(kb(built.size));
  if (built.quality === "high") lines.push("High detail");
  if (built.reused) lines.push("Reused from before");
  return (
    <div className={styles.facts}>
      {lines.length > 0 && <p className={styles.chips}>{lines.map((line) => <span key={line}>{line}</span>)}</p>}
      {built.summary && <p className={shell.lede}>{built.summary}</p>}
      {Array.isArray(built.skipped) && built.skipped.length > 0 && <p className={shell.hint}>Left out: {built.skipped.map(String).join(", ")}.</p>}
    </div>
  );
}

/** The render: Google's model-viewer draws the GLB with its own lighting, and the person can turn it, zoom it and play its animations. Loaded only here. */
function Viewer({ graphId, sha256, clips }: { graphId: string; sha256: string; clips: string[] }) {
  const [ready, setReady] = useState(false);
  const [clip, setClip] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import("@google/model-viewer").then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
  const src = `/api/graphs/${encodeURIComponent(graphId)}/stored/${sha256}`;
  return (
    <div className={styles.viewer}>
      {ready ? (
        createElement("model-viewer", {
          src,
          alt: "The built model",
          "camera-controls": "",
          "auto-rotate": clip ? undefined : "",
          "shadow-intensity": "1",
          "shadow-softness": "0.8",
          exposure: "1.05",
          "interaction-prompt": "none",
          "animation-name": clip ?? undefined,
          autoplay: clip ? "" : undefined,
          class: styles.model,
        })
      ) : (
        <p className={styles.loading}>Loading the viewer…</p>
      )}
      {clips.length > 0 && (
        <ul className={styles.clips} aria-label="Animations">
          <li>
            <button type="button" className={styles.tab} aria-pressed={clip === null} onClick={() => setClip(null)}>
              Turn around
            </button>
          </li>
          {clips.map((name) => (
            <li key={name}>
              <button type="button" className={styles.tab} aria-pressed={clip === name} onClick={() => setClip(name)}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
