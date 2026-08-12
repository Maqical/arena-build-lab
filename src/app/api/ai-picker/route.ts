import { evaluateAIPicker } from "@/lib/ai-picker";
import type { AIPickerRequest } from "@/lib/ai-picker-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as AIPickerRequest;
    return Response.json(await evaluateAIPicker(body));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
}
