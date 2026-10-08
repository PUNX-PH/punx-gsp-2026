"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "@/app/shell.module.css";

export function SignOutButton() {
  const router = useRouter();
  const [error, setError] = useState("");

  async function signOut() {
    setError("");
    try {
      const response = await fetch("/api/session", { method: "DELETE" });
      if (!response.ok) return setError("Could not sign out. Try again.");
    } catch {
      return setError("Could not sign out. Check your connection and try again.");
    }
    router.replace("/sign-in");
    router.refresh(); // drop anything the server rendered for the signed-in person
  }

  return (
    <>
      <button type="button" className={styles.ghost} onClick={signOut}>
        Sign out
      </button>
      {error && <span className={styles.error}> {error}</span>}
    </>
  );
}
