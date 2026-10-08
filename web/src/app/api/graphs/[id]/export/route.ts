import { getGraphApi } from "@/lib/api/server";

// Packing is a zip edit and, for Android, one signing: a few seconds. The packager has its own limits behind this.
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGraphApi().exportGame(req, id);
}
