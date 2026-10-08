import { getGraphApi } from "@/lib/api/server";

// Making a game from one description asks the AI for the script (up to 60 seconds, twice with its one retry), so this limit must outlast that, as Play's does.
export const maxDuration = 300;

export const GET = (req: Request) => getGraphApi().listGraphs(req);
export const POST = (req: Request) => getGraphApi().createGraph(req);
