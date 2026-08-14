import "server-only";

export type LiveStream = { login: string; displayName: string; title: string; viewerCount: number; thumbnailUrl: string; url: string };

export async function liveStreams(logins: string[]): Promise<{ streams: LiveStream[]; configured: boolean; error?: string }> {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim();
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim();
  const unique = [...new Set(logins.map((login) => login.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
  if (!clientId || !clientSecret || unique.length === 0) return { streams: [], configured: Boolean(clientId && clientSecret) };
  try {
    const tokenResponse = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&grant_type=client_credentials`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!tokenResponse.ok) throw new Error(`Twitch token HTTP ${tokenResponse.status}`);
    const token = await tokenResponse.json() as { access_token?: string };
    if (!token.access_token) throw new Error("Twitch token response was incomplete.");
    const query = unique.map((login) => `user_login=${encodeURIComponent(login)}`).join("&");
    const response = await fetch(`https://api.twitch.tv/helix/streams?${query}`, { headers: { "Client-Id": clientId, Authorization: `Bearer ${token.access_token}` }, cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!response.ok) throw new Error(`Twitch streams HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{ user_login:string;user_name:string;title:string;viewer_count:number;thumbnail_url:string }> };
    return { configured: true, streams: (payload.data ?? []).map((entry) => ({ login:entry.user_login,displayName:entry.user_name,title:entry.title,viewerCount:entry.viewer_count,thumbnailUrl:entry.thumbnail_url.replace("{width}","480").replace("{height}","270"),url:`https://www.twitch.tv/${entry.user_login}` })) };
  } catch (error) { return { streams: [], configured: true, error: error instanceof Error ? error.message : String(error) }; }
}
