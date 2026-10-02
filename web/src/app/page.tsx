import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { SignOutButton } from "./SignOutButton";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  return (
    <main className="page">
      <h1>Game Studio</h1>
      <p>Signed in as {user.email}</p>
      <SignOutButton />
    </main>
  );
}
