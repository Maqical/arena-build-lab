const pages = process.argv.slice(2).filter(Boolean);
const targets = pages.length > 0 ? pages : [
  "https://www.metasrc.com/lol/arena/champions",
  "https://www.metasrc.com/lol/arena/champions/riven/build",
];

const endpointPattern = /https?:\\?\/\\?\/[\w.-]+(?:\\?\/|\/)[^\s"'<>\\]+|(?:https?:\/\/)?(?:api|stats|data)[\w.-]*\.metasrc\.com[^\s"'<>]*/gi;
const scriptPattern = /<script[^>]+src=["']([^"']+)["']/gi;

async function main(): Promise<void> {
for (const target of targets) {
  const response = await fetch(target, { headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "ArenaBuildLab/1.0 (local reference client)", Referer: "https://www.metasrc.com/" } });
  if (!response.ok) { console.error(`${response.status} ${target}`); continue; }
  const html = await response.text();
  const scripts = [...html.matchAll(scriptPattern)].map((match) => match[1]);
  const endpoints = [...new Set((html.match(endpointPattern) ?? []).map((value) => value.replaceAll("\\/", "/")))];
  console.log(JSON.stringify({ target, status: response.status, bytes: html.length, scripts, endpoints }, null, 2));
}
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
