"use client";

import { useRouter } from "next/navigation";

export function SignOutButton() {
  const router = useRouter();

  async function signOut() {
    await fetch("/api/session", { method: "DELETE" });
    router.replace("/sign-in");
    router.refresh(); // drop anything the server rendered for the signed-in person
  }

  return <button onClick={signOut}>Sign out</button>;
}
