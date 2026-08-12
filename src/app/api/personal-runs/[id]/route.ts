import { deletePersonalRun, PersonalRunValidationError } from "@/lib/personal-runs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const deleted = deletePersonalRun(Number(id));
    return deleted ? new Response(null, { status: 204 }) : Response.json({ error: "Run not found." }, { status: 404 });
  } catch (error) {
    if (error instanceof PersonalRunValidationError) return Response.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
