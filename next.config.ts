import type { NextConfig } from "next";
import path from "node:path";
import { CONTENT_SECURITY_POLICY } from "./lib/security-headers";

const cloudflareWorkersStub = path.resolve(process.cwd(), "lib/cloudflare-workers-stub.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  turbopack: {
    resolveAlias: {
      "cloudflare:workers": "./lib/cloudflare-workers-stub.ts",
    },
  },
  webpack(config) {
    config.resolve.alias["cloudflare:workers"] = cloudflareWorkersStub;
    return config;
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "no-store" }],
      },
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
        ],
      },
    ];
  },
};

export default nextConfig;
