import { getGraphApi } from "@/lib/api/server";

// A run takes about a second, but a Describe Game step can wait on the model for up to 60 seconds, twice (one retry). The limit must
// outlast that so the step's own timeout fires first (and gives the daily count back): lib/ai/duration.test.ts holds the sum.
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return getGraphApi().play(req, id);
}
