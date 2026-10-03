import { getGraphApi } from "@/lib/api/server";

// A run takes about a second; this leaves room for a slow decode or storage call.
export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGraphApi().play(req, id);
}
