import { getGraphApi } from "@/lib/api/server";

// One short call to the AI (up to 40 seconds), well inside the limit.
export const maxDuration = 60;

export const POST = (req: Request) => getGraphApi().refinePrompt(req);
