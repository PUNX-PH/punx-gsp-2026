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
  const [improving, setImproving] = useState(false);
  const [before, setBefore] = useState<string | null>(null); // what the person wrote, kept while the improved text is in the box, so Undo can bring it back
  const [error, setError] = useState("");
  const left = MAX_PROMPT_CHARACTERS - Array.from(words).length;

  // The AI rewrites the rough idea as a clearer description. It only fills the box: the person reads it, changes it, and presses Make it themselves.
  async function improve() {
    setError("");
    setImproving(true);
    try {
      const response = await fetch("/api/refine", { method: "POST", body: JSON.stringify({ describe: words.trim() }) });
      if (response.status === 401) return router.replace("/sign-in");
      const body = (await response.json().catch(() => ({}))) as { refined?: string; error?: string };
      if (!response.ok || typeof body.refined !== "string") return setError(body.error ?? "Could not improve the prompt. Try again.");
      setBefore(words);
      setWords(body.refined);
    } catch {
      setError("The request did not finish. Check your connection and try again.");
    } finally {
      setImproving(false);
    }
  }

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
        disabled={busy || improving}
        placeholder="A fox that jumps over logs and collects berries. Tap to jump."
        onChange={(event) => {
          setWords(event.target.value);
          setBefore(null); // typing after an improvement keeps the improved text: there is nothing to undo to
        }}
      />
      <div className={styles.makeItBar}>
        <span className={styles.hint}>{left} characters left. The AI writes the game and builds its models. You can change every step afterwards.</span>
        <div className={styles.makeItButtons}>
          {before !== null && !improving ? (
            <button type="button" className={styles.button} onClick={() => { setWords(before); setBefore(null); }} disabled={busy}>
              Undo
            </button>
          ) : (
            <button type="button" className={styles.button} onClick={() => void improve()} disabled={busy || improving || Array.from(words.trim()).length < 3}>
              {improving ? "Improving…" : "Improve my prompt"}
            </button>
          )}
          <button type="submit" className={styles.cta} disabled={busy || improving || words.trim() === ""}>
            {busy ? "Making your game…" : "Make it"}
          </button>
        </div>
      </div>
      <p className={styles.hint} role="status" aria-live="polite">
        {busy ? "Writing the game. This can take up to a minute; the steps appear when it is done." : improving ? "Making your idea clearer…" : before !== null ? "Improved. Change anything you like, then press Make it." : ""}
      </p>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
