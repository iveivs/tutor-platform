import application from "./dist/server/index.js";
import { settleAllWorkspaces } from "./lib/lesson-maintenance";
import { anonymousRequestKey, enforceRateLimit, sessionRequestKey } from "./lib/request-security";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "POST" && ["/api/auth/login", "/api/auth/invite"].includes(url.pathname)) {
      const limited = await enforceRateLimit(env.AUTH_RATE_LIMITER, await anonymousRequestKey(request, url.pathname), "public_auth");
      if (limited) return limited;
    }
    if (request.method === "POST" && url.pathname === "/api/app-data") {
      const limited = await enforceRateLimit(env.API_WRITE_RATE_LIMITER, await sessionRequestKey(request, url.pathname), "api_write");
      if (limited) return limited;
    }
    return application.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(settleAllWorkspaces(env.DB));
  },
} satisfies ExportedHandler<Env>;
