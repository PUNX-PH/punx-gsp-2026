import { getApi } from "@/lib/api/server";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  return getApi().putFile(req, id, name);
}
