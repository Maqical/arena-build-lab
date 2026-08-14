import { getDatabase } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

export function GET() {
  const rows = getDatabase().prepare("SELECT id,kind,title,body,created_at FROM notification_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 10").all() as Row[];
  return Response.json({ notifications: rows.map((row) => ({ id: Number(row.id), kind: String(row.kind), title: String(row.title), body: String(row.body), createdAt: String(row.created_at) })) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const value = await request.json().catch(() => ({})) as { ids?: unknown[] };
  const ids = (value.ids ?? []).map(Number).filter((id) => Number.isInteger(id) && id > 0);
  const update = getDatabase().prepare("UPDATE notification_outbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL");
  const now = new Date().toISOString();
  for (const id of ids) update.run(now, id);
  return Response.json({ ok: true, delivered: ids.length });
}
