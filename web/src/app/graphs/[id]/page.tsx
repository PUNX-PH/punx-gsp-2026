import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { getGraphService } from "@/lib/graph/firebase";
import { GraphError } from "@/lib/graph/types";
import { Editor } from "./Editor";

export default async function GraphPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Someone else's graph and one that does not exist are the same 404.
  const record = await getGraphService()
    .getGraph(user, id)
    .catch((error: unknown) => {
      if (error instanceof GraphError && error.status === 404) notFound();
      throw error;
    });

  return <Editor id={record.id} name={record.name} initialGraph={record.graph} initialAssets={record.assets} initialRunId={record.lastRunId} />;
}
