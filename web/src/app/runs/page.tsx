import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/app/AppHeader";
import { RunActions } from "@/app/RunActions";
import styles from "@/app/shell.module.css";
import { ThemedShell } from "@/app/graphs/ThemedShell";
import { currentUser } from "@/lib/auth/server";
import { getRunService } from "@/lib/runs/firebase";

export default async function RunsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const runs = await getRunService().listRuns(user);

  return (
    <ThemedShell>
      <div className={styles.shell}>
        <AppHeader email={user.email} current="runs" />
        <main className={styles.main}>
          <h1 className={styles.title}>Runs</h1>
          <p className={styles.lede}>A run is a game&apos;s settings and models, stored so it can be played. Pressing Play in a game makes one. You can also add your own files.</p>
          <div className={styles.actions}>
            <Link href="/runs/new" className={styles.cta}>
              Add a run
            </Link>
          </div>

          {runs.length === 0 ? (
            <div className={styles.empty}>
              <strong>No runs yet</strong>
              <span>Open a game and press Play, or add a settings file and the models it names.</span>
            </div>
          ) : (
            <ul className={styles.rows}>
              {runs.map((run) => (
                <li key={run.id} className={styles.row}>
                  <span className={styles.name}>{new Date(run.createdAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                  <span className={styles.pill} data-state={run.status === "ready" ? "ready" : "pending"}>
                    {run.status === "ready" ? "Ready" : "Not finished"}
                  </span>
                  <RunActions id={run.id} ready={run.status === "ready"} />
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </ThemedShell>
  );
}
