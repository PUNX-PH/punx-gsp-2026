"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/app/graphs/[id]/editor.module.css";

async function message(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export function NewGraphButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(starter: true | "described") {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/graphs", { method: "POST", body: JSON.stringify({ starter }) });
      if (response.status === 401) return router.replace("/sign-in");
      if (!response.ok) return setError(await message(response, "Could not make a graph."));
      const created = (await response.json()) as { id: string };
      router.push(`/graphs/${encodeURIComponent(created.id)}`);
    } catch {
      setError("The request did not finish. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <p>
      <button type="button" className={styles.play} onClick={() => create("described")} disabled={busy}>
        New: describe a game
      </button>{" "}
      <button type="button" className={styles.secondary} onClick={() => create(true)} disabled={busy}>
        New from starter
      </button>
      {error && <span className={styles.errorText}> {error}</span>}
    </p>
  );
}

export function DeleteGraphButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm("Delete this graph, its files and its game?")) return;
    try {
      const response = await fetch(`/api/graphs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (response.status === 401) return router.replace("/sign-in");
      if (!response.ok) return setError(await message(response, "Could not delete this graph."));
      router.refresh();
    } catch {
      setError("The request did not finish. Check your connection and try again.");
    }
  }

  return (
    <>
      <button type="button" className={styles.secondary} onClick={remove}>
        Delete
      </button>
      {error && <span className={styles.errorText}> {error}</span>}
    </>
  );
}
