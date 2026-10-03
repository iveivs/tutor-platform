import type { NextConfig } from "next";
import path from "node:path";
import { CONTENT_SECURITY_POLICY } from "./lib/security-headers";

const cloudflareWorkersStub = path.resolve(process.cwd(), "lib/cloudflare-workers-stub.ts");
const postgresD1Adapter = path.resolve(process.cwd(), "db/postgres-d1.ts");
const postgresAuth = path.resolve(process.cwd(), "lib/node-auth.ts");
const postgresAuthEndpoints = path.resolve(process.cwd(), "lib/postgres-auth-endpoints.ts");
const postgresAccountEndpoints = path.resolve(process.cwd(), "lib/postgres-account-endpoints.ts");
const postgresEmail = path.resolve(process.cwd(), "lib/postgres-email.ts");
const postgresRateLimit = path.resolve(process.cwd(), "lib/postgres-rate-limit.ts");

const nodeCompatibility: NextConfig = process.env.TUTOR_RUNTIME_TARGET === "node" ? {
  turbopack: {
    resolveAlias: {
      "cloudflare:workers": "./lib/cloudflare-workers-stub.ts",
      "@/db/d1": "./db/postgres-d1.ts",
      "@/lib/auth": "./lib/node-auth.ts",
      "@/lib/node-auth-endpoints": "./lib/postgres-auth-endpoints.ts",
      "@/lib/node-account-endpoints": "./lib/postgres-account-endpoints.ts",
      "@/lib/account-email": "./lib/postgres-email.ts",
      "@/lib/node-rate-limit": "./lib/postgres-rate-limit.ts",
    },
  },
  webpack(config) {
    config.resolve.alias["cloudflare:workers"] = cloudflareWorkersStub;
    config.resolve.alias["@/db/d1"] = postgresD1Adapter;
    config.resolve.alias["@/lib/auth"] = postgresAuth;
    config.resolve.alias["@/lib/node-auth-endpoints"] = postgresAuthEndpoints;
    config.resolve.alias["@/lib/node-account-endpoints"] = postgresAccountEndpoints;
    config.resolve.alias["@/lib/account-email"] = postgresEmail;
    config.resolve.alias["@/lib/node-rate-limit"] = postgresRateLimit;
    return config;
  },
} : {};

const nextConfig: NextConfig = {
  ...nodeCompatibility,
  output: "standalone",
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
