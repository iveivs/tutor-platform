import application from "./dist/server/index.js";
import { settleAllWorkspaces } from "./lib/lesson-maintenance";

export default {
  fetch(request, env, ctx) {
    return application.fetch(request, env, ctx);
  },
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(settleAllWorkspaces(env.DB));
  },
} satisfies ExportedHandler<Env>;
