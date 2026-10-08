import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/app/AppHeader";
import shell from "@/app/shell.module.css";
import { ThemedShell } from "@/app/graphs/ThemedShell";
import { currentUser } from "@/lib/auth/server";
import { getGraphService } from "@/lib/graph/firebase";
import { GraphError } from "@/lib/graph/types";
import { Studio } from "./Studio";

export default async function StudioPage({ params }: { params: Promise<{ id: string; node: string }> }) {
  const { id, node: nodeId } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  const record = await getGraphService()
    .getGraph(user, id)
    .catch((error: unknown) => {
      if (error instanceof GraphError && error.status === 404) notFound();
      throw error;
    });
  const node = record.graph.nodes.find((n) => n.id === nodeId);
  if (!node || (node.type !== "build-model" && node.type !== "build-environment")) notFound();

  return (
    <ThemedShell>
      <div className={shell.shell}>
        <AppHeader email={user.email} current="games" />
        <Studio graphId={record.id} graphName={record.name} graph={record.graph} nodeId={node.id} />
      </div>
    </ThemedShell>
  );
}
