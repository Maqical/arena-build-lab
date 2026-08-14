import { proPlayers, setProFollow } from "@/lib/pro-players";
import { selectedRegion } from "@/lib/region";
export const runtime="nodejs"; export const dynamic="force-dynamic";
export async function GET(request:Request){return Response.json({players:proPlayers(selectedRegion(new URL(request.url).searchParams.get("region")))});}
export async function POST(request:Request){const body=await request.json() as {puuid?:string;follow?:boolean};if(!body.puuid||!setProFollow(body.puuid,Boolean(body.follow)))return Response.json({error:"Unknown tracked player."},{status:404});return Response.json({ok:true});}
