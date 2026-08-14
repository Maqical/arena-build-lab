import { liveStreams } from "@/lib/twitch";
export const runtime="nodejs";export const dynamic="force-dynamic";
export async function GET(){const logins=(process.env.ARENA_TWITCH_LOGINS??"").split(",");return Response.json(await liveStreams(logins),{headers:{"Cache-Control":"no-store"}});}
