"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/app/shell.module.css";

async function message(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? fallback;
}

export function NewGraphButton() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(starter: true | "described" | "built") {
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
    <div className={styles.actions}>
      <button type="button" className={styles.cta} onClick={() => create("described")} disabled={busy}>
        Describe a game
      </button>
      <button type="button" className={styles.button} onClick={() => create("built")} disabled={busy}>
        Build a character
      </button>
      <button type="button" className={styles.button} onClick={() => create(true)} disabled={busy}>
        Start from the starter
      </button>
      {error && <span className={styles.error}> {error}</span>}
    </div>
  );
}

export function DeleteGraphButton({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm("Delete this game, its files and its run?")) return;
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
      <button type="button" className={styles.ghost} onClick={remove}>
        Delete
      </button>
      {error && <span className={styles.error}> {error}</span>}
    </>
  );
}
