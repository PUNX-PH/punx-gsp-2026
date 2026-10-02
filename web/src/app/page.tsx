import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { getRunService } from "@/lib/runs/firebase";
import { RunActions } from "./RunActions";
import { SignOutButton } from "./SignOutButton";

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const runs = await getRunService().listRuns(user);

  return (
    <main className="page">
      <h1>Game Studio</h1>
      <p className="note">
        Signed in as {user.email} <SignOutButton />
      </p>

      <p>
        <Link href="/runs/new">Add a run</Link>
      </p>

      {runs.length === 0 ? (
        <p>You have no runs yet. Add a settings file and its models to play a game.</p>
      ) : (
        <ul>
          {runs.map((run) => (
            <li key={run.id}>
              {new Date(run.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC, {run.status === "ready" ? "ready" : "not finished"}{" "}
              <RunActions id={run.id} ready={run.status === "ready"} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
