import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/app/AppHeader";
import styles from "@/app/shell.module.css";
import { currentUser } from "@/lib/auth/server";
import { getGraphService } from "@/lib/graph/firebase";
import { DeleteGraphButton, NewGraphButton } from "./NewGraphButton";
import { ThemedShell } from "./ThemedShell";

export default async function GraphsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const graphs = await getGraphService().listGraphs(user);

  return (
    <ThemedShell>
      <div className={styles.shell}>
        <AppHeader email={user.email} current="games" />
        <main className={styles.main}>
          <h1 className={styles.title}>Your games</h1>
          <p className={styles.lede}>Each game is a set of steps wired together on a canvas. Open one to change it and play it, or start a new one.</p>

          <NewGraphButton />

          {graphs.length === 0 ? (
            <div className={styles.empty}>
              <strong>No games yet</strong>
              <span>Describe the game you want and the steps are made for you, or start from the starter and change it.</span>
            </div>
          ) : (
            <ul className={styles.rows}>
              {graphs.map((graph) => (
                <li key={graph.id} className={styles.row}>
                  <Link href={`/graphs/${encodeURIComponent(graph.id)}`} className={styles.name}>
                    {graph.name}
                  </Link>
                  <span className={styles.meta}>Edited {new Date(graph.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                  <DeleteGraphButton id={graph.id} />
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </ThemedShell>
  );
}
