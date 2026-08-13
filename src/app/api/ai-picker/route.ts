import { evaluateAIPicker } from "@/lib/ai-picker";
import type { AIPickerRequest } from "@/lib/ai-picker-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as AIPickerRequest;
    const needsVision = Boolean(body.screenshotDataUrl) && (body.offeredAugmentKeys?.length ?? 0) !== 3;
    if (needsVision && !process.env.OPENAI_API_KEY?.trim()) {
      return Response.json({ error: "OpenAI API key missing. Add it in Settings to use AI vision." }, { status: 400 });
    }
    return Response.json(await evaluateAIPicker(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const aiFailure = /openai|api key|structured output|AI request/i.test(message);
    return Response.json({ error: aiFailure ? `AI vision is temporarily unavailable. Select the three augments manually to keep using stat math. ${message}` : message }, { status: aiFailure ? 503 : 400 });
  }
}
