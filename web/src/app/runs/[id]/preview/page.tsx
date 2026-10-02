import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/server";
import { getRunService } from "@/lib/runs/firebase";
import { PreviewFrame } from "./PreviewFrame";

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect("/sign-in");

  // Only the caller's own runs are listed, so a run id that is someone else's or does not exist is the same 404.
  const run = (await getRunService().listRuns(user)).find((r) => r.id === id);
  if (!run || run.status !== "ready") notFound();

  return <PreviewFrame runId={run.id} />;
}
