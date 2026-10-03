import { getGraphApi } from "@/lib/api/server";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGraphApi().addAsset(req, id);
}
