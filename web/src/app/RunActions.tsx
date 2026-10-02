"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function RunActions({ id, ready }: { id: string; ready: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");

  async function remove() {
    if (!window.confirm("Delete this run and its files?")) return;
    const response = await fetch(`/api/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (response.status === 401) return router.replace("/sign-in");
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return setError(body.error ?? "Could not delete this run.");
    }
    router.refresh();
  }

  return (
    <>
      {ready && <Link href={`/runs/${encodeURIComponent(id)}/preview`}>Preview</Link>}{" "}
      <button onClick={remove}>Delete</button>
      {error && <span className="error"> {error}</span>}
    </>
  );
}
