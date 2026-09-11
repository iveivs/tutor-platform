import { env } from "cloudflare:workers";

export function getD1(): D1Database {
  if (!env.DB) throw new Error("База данных временно недоступна");
  return env.DB;
}
