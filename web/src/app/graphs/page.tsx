import Link from "next/link";
import { redirect } from "next/navigation";
import styles from "@/app/graphs/[id]/editor.module.css";
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
      <main className={styles.listPage}>
        <h1 className={styles.listTitle}>Your graphs</h1>
        <p className={styles.hint}>A graph is a game: the steps that make it, wired together. Open one to build and play it.</p>

        <NewGraphButton />

        {graphs.length === 0 ? (
          <p className={styles.hint}>You have no graphs yet. Describe a game, build a character, or start from the starter graph.</p>
        ) : (
          <ul className={styles.listRows}>
            {graphs.map((graph) => (
              <li key={graph.id} className={styles.listRow}>
                <Link href={`/graphs/${encodeURIComponent(graph.id)}`} className={styles.listName}>
                  {graph.name}
                </Link>
                <span className={styles.listMeta}>{new Date(graph.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>
                <DeleteGraphButton id={graph.id} />
              </li>
            ))}
          </ul>
        )}

        <p>
          <Link href="/" className={styles.listBack}>
            Back to your runs
          </Link>
        </p>
      </main>
    </ThemedShell>
  );
}
