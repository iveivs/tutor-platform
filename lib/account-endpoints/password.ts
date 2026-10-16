import "server-only";

import { randomUUID } from "node:crypto";
import { getPostgresPool } from "@/db/postgres";
import { randomToken, hashPassword, sha256 } from "@/lib/node-auth";
import { recoverySchema, publicMutation, resetSchema } from "@/lib/account-endpoints/shared";
import { sendPasswordRecovery } from "@/lib/postgres-email";
import { readLimitedJson } from "@/lib/request-security";

export async function handleNodeRecover(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = recoverySchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Введите корректный email" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const result = await getPostgresPool().query("SELECT id, full_name FROM users WHERE lower(email) = $1 AND disabled_at IS NULL LIMIT 1", [email]);
  const user = result.rows[0];
  if (user) {
    const token = randomToken();
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE auth_tokens SET consumed_at = now() WHERE user_id = $1 AND purpose IN ('password_reset', 'set_password') AND consumed_at IS NULL", [user.id]);
      await client.query(`INSERT INTO auth_tokens (id, user_id, email, purpose, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour')`, [randomUUID(), user.id, email, "password_reset", await sha256(token)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
    const baseUrl = new URL("/", process.env.PUBLIC_APP_URL ?? request.url);
    baseUrl.hash = `access_token=${encodeURIComponent(token)}&type=recovery`;
    await sendPasswordRecovery(email, String(user.full_name), baseUrl.toString());
  } else {
    await sha256(randomToken());
  }
  return Response.json({ ok: true });
}
export async function handleNodeResetPassword(request: Request): Promise<Response> {
  const limited = await publicMutation(request);
  if (limited) return limited;
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = resetSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Пароль должен содержать от 8 до 128 символов" }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT id, user_id FROM auth_tokens WHERE token_hash = $1
      AND purpose IN ('password_reset', 'set_password') AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`, [await sha256(parsed.data.accessToken)]);
    const token = result.rows[0];
    if (!token?.user_id) { await client.query("ROLLBACK"); return Response.json({ error: "Ссылка недействительна или устарела" }, { status: 401 }); }
    await client.query("UPDATE users SET password_hash = $1, password_set_at = now(), updated_at = now() WHERE id = $2 AND disabled_at IS NULL", [await hashPassword(parsed.data.password), token.user_id]);
    await client.query("UPDATE auth_tokens SET consumed_at = now() WHERE id = $1", [token.id]);
    await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [token.user_id]);
    await client.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
