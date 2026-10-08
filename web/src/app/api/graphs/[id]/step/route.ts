import { getGraphApi } from "@/lib/api/server";

// One step for the studio window: a model or a world can take as long as a whole Play (the AI, then Blender), so the limit is Play's.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGraphApi().playStep(req, id);
}
