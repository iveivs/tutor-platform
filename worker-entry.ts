import application from "./dist/server/index.js";
import { settleAllWorkspaces } from "./lib/lesson-maintenance";
import { anonymousRequestKey, enforceRateLimit, sessionRequestKey } from "./lib/request-security";
import { applySecurityHeaders } from "./lib/security-headers";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/admin.") {
      url.pathname = "/admin";
      return Response.redirect(url.toString(), 308);
    }
    if (request.method === "POST" && url.pathname === "/api/auth/register") {
      const limited = await enforceRateLimit(env.REGISTRATION_RATE_LIMITER, await anonymousRequestKey(request, url.pathname), "teacher_registration");
      if (limited) return applySecurityHeaders(limited, request);
    }
    if (request.method === "POST" && ["/api/auth/login", "/api/auth/invite", "/api/auth/teacher-invite", "/api/auth/recover", "/api/auth/reset-password"].includes(url.pathname)) {
      const limited = await enforceRateLimit(env.AUTH_RATE_LIMITER, await anonymousRequestKey(request, url.pathname), "public_auth");
      if (limited) return applySecurityHeaders(limited, request);
    }
    if (request.method === "POST" && ["/api/app-data", "/api/admin/workspaces"].includes(url.pathname)) {
      const limited = await enforceRateLimit(env.API_WRITE_RATE_LIMITER, await sessionRequestKey(request, url.pathname), "api_write");
      if (limited) return applySecurityHeaders(limited, request);
    }
    return applySecurityHeaders(await application.fetch(request, env, ctx), request);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(settleAllWorkspaces(env.DB));
  },
} satisfies ExportedHandler<Env>;
