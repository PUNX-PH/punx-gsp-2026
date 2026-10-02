"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { rolesNeeded, validateSettings } from "@/lib/settings";
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
    const plan = planUploads(rolesNeeded(checked.settings), models, MAX_GLB_BYTES);
    if (!plan.ok) return setError(plan.error);

    setBusy(true);
    try {
      const created = await fetch("/api/runs", { method: "POST", body: text });
      if (created.status === 401) return router.replace("/sign-in");
      const createdBody = (await created.json()) as { id?: string; error?: string };
      if (!created.ok || !createdBody.id) return setError(createdBody.error ?? "Something went wrong on our side");

      const id = createdBody.id;
      setResults(plan.uploads.map((u) => ({ name: u.name, state: "uploading" as const })));
      const outcomes = await Promise.all(
        plan.uploads.map(async ({ name, file }) => {
          try {
            const response = await fetch(`/api/runs/${encodeURIComponent(id)}/files/${encodeURIComponent(name)}`, {
              method: "PUT",
              body: await file.arrayBuffer(),
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
    <main className="page">
      <h1>Add a run</h1>
      <form onSubmit={submit} className="page">
        <label htmlFor="settings">Settings file (settings.json)</label>
        <input id="settings" type="file" accept=".json,application/json" onChange={(e) => setSettingsFile(e.target.files?.[0] ?? null)} />

        <label htmlFor="models">Models (the .glb files your settings name)</label>
        <input id="models" type="file" accept=".glb,model/gltf-binary" multiple onChange={(e) => setModels(Array.from(e.target.files ?? []))} />

        <button type="submit" disabled={busy}>
          {busy ? "Uploading…" : "Upload"}
        </button>
      </form>

      {error && <p className="error" role="alert">{error}</p>}

      {results.length > 0 && (
        <ul>
          {results.map((r) => (
            <li key={r.name}>
              {r.name}: {r.state === "uploading" ? "uploading…" : r.state === "uploaded" ? "uploaded" : <span className="error">{r.message}</span>}
            </li>
          ))}
        </ul>
      )}

      {runId && (
        <p>
          <Link href={`/runs/${encodeURIComponent(runId)}/preview`}>Open the Preview</Link>
        </p>
      )}
      <p>
        <Link href="/">Back to your runs</Link>
      </p>
    </main>
  );
}
