import { getGraphApi } from "@/lib/api/server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string; sha: string }> }) {
  const { id, sha } = await params;
  return getGraphApi().getAsset(req, id, sha);
}
