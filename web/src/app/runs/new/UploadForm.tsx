"use client";

import Link from "next/link";
import styles from "@/app/shell.module.css";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { checkGlb } from "@/lib/glb";
import { filesNeeded, validateSettings } from "@/lib/settings";
import { planUploads } from "@/lib/uploadPlan";

const MAX_GLB_BYTES = 4 * 1024 * 1024;

type Result = { name: string; state: "uploading" | "uploaded" | "failed"; message?: string };

export function UploadForm() {
  const router = useRouter();
  const [settingsFile, setSettingsFile] = useState<File | null>(null);
  const [models, setModels] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [runId, setRunId] = useState<string | null>(null);

  const setResult = (name: string, change: Partial<Result>) =>
    setResults((current) => current.map((r) => (r.name === name ? { ...r, ...change } : r)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setResults([]);
    setRunId(null);

    if (!settingsFile) return setError("Choose your settings.json file.");
    const text = await settingsFile.text();
    // The same rules the server applies, so a mistake shows before anything is created or sent.
    const checked = validateSettings(text);
    if (!checked.ok) return setError(checked.error);
    const plan = planUploads(filesNeeded(checked.settings), models, MAX_GLB_BYTES);
    if (!plan.ok) return setError(plan.error);

    // Each file is read once and given the same GLB check the server runs, so a bad file is reported now, before a
    // run is created and left half-finished.
    const files: { name: string; buffer: ArrayBuffer }[] = [];
    for (const { name, file } of plan.uploads) {
      const buffer = await file.arrayBuffer();
      const glb = checkGlb(name, new Uint8Array(buffer));
      if (!glb.ok) return setError(glb.error);
      files.push({ name, buffer });
    }

    setBusy(true);
    try {
      const created = await fetch("/api/runs", { method: "POST", body: text });
      if (created.status === 401) return router.replace("/sign-in");
      const createdBody = (await created.json()) as { id?: string; error?: string };
      if (!created.ok || !createdBody.id) return setError(createdBody.error ?? "Something went wrong on our side");

      const id = createdBody.id;
      setResults(files.map((f) => ({ name: f.name, state: "uploading" as const })));
      const outcomes = await Promise.all(
        files.map(async ({ name, buffer }) => {
          try {
            const response = await fetch(`/api/runs/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, {
              method: "PUT",
              body: buffer,
            });
            if (response.status === 401) {
              router.replace("/sign-in");
              return false;
            }
            if (response.ok) {
              setResult(name, { state: "uploaded" });
              return true;
            }
            const body = (await response.json().catch(() => ({}))) as { error?: string };
            setResult(name, { state: "failed", message: body.error ?? "Upload failed." });
            return false;
          } catch {
            setResult(name, { state: "failed", message: `${name}: the upload did not finish. Check your connection.` });
            return false;
          }
        }),
      );
      if (outcomes.every(Boolean)) setRunId(id);
    } catch {
      setError("The upload did not finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
      <h1 className={styles.title}>Add a run</h1>
      <p className={styles.lede}>Choose a game&apos;s settings file and the models it names. They are stored together so the game can be played.</p>
      <form onSubmit={submit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="settings">Settings file</label>
          <input id="settings" className={styles.input} type="file" accept=".json,application/json" onChange={(e) => setSettingsFile(e.target.files?.[0] ?? null)} />
          <span className={styles.hint}>settings.json</span>
        </div>

        <div className={styles.field}>
          <label htmlFor="models">Models</label>
          <input id="models" className={styles.input} type="file" accept=".glb,model/gltf-binary" multiple onChange={(e) => setModels(Array.from(e.target.files ?? []))} />
          <span className={styles.hint}>The .glb files your settings name.</span>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.cta} disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
          <Link href="/runs" className={styles.link}>
            Back to your runs
          </Link>
        </div>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      {results.length > 0 && (
        <ul className={styles.results}>
          {results.map((r) => (
            <li key={r.name}>
              {r.name}: {r.state === "uploading" ? "uploading…" : r.state === "uploaded" ? "uploaded" : <span className={styles.error}>{r.message}</span>}
            </li>
          ))}
        </ul>
      )}

      {runId && (
        <div className={styles.actions}>
          <Link href={`/runs/${encodeURIComponent(runId)}/preview`} className={styles.cta}>
            Play it
          </Link>
        </div>
      )}
    </main>
  );
}
