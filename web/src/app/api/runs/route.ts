import { getApi } from "@/lib/api/server";

export const GET = (req: Request) => getApi().listRuns(req);
export const POST = (req: Request) => getApi().createRun(req);
