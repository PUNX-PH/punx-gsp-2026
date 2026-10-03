import { getGraphApi } from "@/lib/api/server";

type Context = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Context) {
  const { id } = await params;
  return getGraphApi().getGraph(req, id);
}

export async function PUT(req: Request, { params }: Context) {
  const { id } = await params;
  return getGraphApi().saveGraph(req, id);
}

export async function DELETE(req: Request, { params }: Context) {
  const { id } = await params;
  return getGraphApi().deleteGraph(req, id);
}
