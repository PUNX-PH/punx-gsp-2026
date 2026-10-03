import { getGraphApi } from "@/lib/api/server";

export const GET = (req: Request) => getGraphApi().listGraphs(req);
export const POST = (req: Request) => getGraphApi().createGraph(req);
