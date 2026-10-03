import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { getGraphService } from "@/lib/graph/firebase";
import { DeleteGraphButton, NewGraphButton } from "./NewGraphButton";

export default async function GraphsPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const graphs = await getGraphService().listGraphs(user);

  return (
    <main className="page">
      <h1>Your graphs</h1>
      <p className="note">A plain page for building and playing a graph. The node canvas replaces it.</p>

      <NewGraphButton />

      {graphs.length === 0 ? (
        <p>You have no graphs yet. Start from the starter graph.</p>
      ) : (
        <ul>
          {graphs.map((graph) => (
            <li key={graph.id}>
              <Link href={`/graphs/${encodeURIComponent(graph.id)}`}>{graph.name}</Link>{" "}
              <span className="note">{new Date(graph.updatedAt).toISOString().slice(0, 16).replace("T", " ")} UTC</span>{" "}
              <DeleteGraphButton id={graph.id} />
            </li>
          ))}
        </ul>
      )}

      <p>
        <Link href="/">Back to your runs</Link>
      </p>
    </main>
  );
}
