import { getApi } from "@/lib/api/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  return getApi().getFile(req, id, file);
}
