"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/app/shell.module.css";
import { MAX_PROMPT_CHARACTERS } from "@/lib/graph/registry";

/**
 * The way in: say what the game is, and the whole graph is made. The AI writes the game and names the models it needs; the site makes a step for
 * each, wires them to the template and the preview, and the editor opens with Play already pressed.
 */
export function MakeItBox() {
  const router = useRouter();
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const left = MAX_PROMPT_CHARACTERS - Array.from(words).length;

  async function makeIt() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch("/api/graphs", { method: "POST", body: JSON.stringify({ describe: words.trim() }) });
      if (response.status === 401) return router.replace("/sign-in");
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not make the game. Try again.");
        return setBusy(false);
      }
      const created = (await response.json()) as { id: string };
      router.push(`/graphs/${encodeURIComponent(created.id)}?play=1`);
    } catch {
      setError("The request did not finish. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form
      className={styles.makeIt}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && words.trim() !== "") void makeIt();
      }}
    >
      <label htmlFor="make-it" className={styles.makeItLabel}>
        What game do you want?
      </label>
      <textarea
        id="make-it"
        className={styles.makeItText}
        value={words}
        maxLength={MAX_PROMPT_CHARACTERS}
        rows={4}
        disabled={busy}
        placeholder="A fox that jumps over logs and collects berries. Tap to jump."
        onChange={(event) => setWords(event.target.value)}
      />
      <div className={styles.makeItBar}>
        <span className={styles.hint}>{left} characters left. The AI writes the game and builds its models. You can change every step afterwards.</span>
        <button type="submit" className={styles.cta} disabled={busy || words.trim() === ""}>
          {busy ? "Making your game…" : "Make it"}
        </button>
      </div>
      <p className={styles.hint} role="status" aria-live="polite">
        {busy ? "Writing the game. This can take up to a minute; the steps appear when it is done." : ""}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
