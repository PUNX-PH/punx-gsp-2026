import { getApi } from "@/lib/api/server";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getApi().deleteRun(req, id);
}
