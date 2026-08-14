import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": ["data/*.sqlite", "data/*.sqlite-*", "tests/fixtures/*.local.json", "qa/**/*", "logs/**/*"],
  },
  serverExternalPackages: ["node:sqlite"],
  allowedDevOrigins: ["127.0.0.1"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "raw.communitydragon.org" },
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
};

export default nextConfig;
