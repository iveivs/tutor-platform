import { getD1 } from "@/db/d1";
import { assertSameOrigin, getAuthConfig } from "@/lib/auth";
import { readLimitedJson } from "@/lib/request-security";
import { requestTeacherSignup } from "@/lib/supabase-registration";
import { z } from "zod";

const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  professionalTitle: z.string().trim().max(50),
  email: z.string().trim().email().max(254),
  password: z.string().min(8).max(128),
  website: z.string().max(200).optional(),
}).strict();

const acceptedResponse = () => Response.json({
  ok: true,
  message: "Проверьте почту и подтвердите адрес. После этого войдите — кабинет будет создан автоматически.",
}, { headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const config = getAuthConfig();
  if (!config) return Response.json({ error: "Регистрация временно недоступна" }, { status: 503 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = registrationSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте имя, email и пароль от 8 до 128 символов" }, { status: 400 });
  if (parsed.data.website) return acceptedResponse();

  const email = parsed.data.email.toLowerCase();
  const redirectTo = new URL("/", process.env.PUBLIC_APP_URL ?? request.url).toString();
  const signup = await requestTeacherSignup(config, { email, password: parsed.data.password, displayName: parsed.data.name, redirectTo });
  if (!signup.ok) {
    if (signup.reason === "rate_limit") return Response.json({ error: "Слишком много попыток. Попробуйте позже." }, { status: 429, headers: { "Retry-After": "60" } });
    if (signup.reason === "configuration") {
      console.error(JSON.stringify({ event: "teacher_registration_rejected", reason: "email_confirmation_disabled" }));
    }
    return Response.json({ error: "Регистрация временно недоступна" }, { status: 503 });
  }
  if (!signup.deliverable) return acceptedResponse();

  const db = getD1();
  const now = Date.now();
  try {
    await db.prepare(`INSERT INTO teacher_registrations (id, auth_subject, email, display_name, professional_title, status, expires_at)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
      ON CONFLICT(auth_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name,
        professional_title = excluded.professional_title, expires_at = excluded.expires_at, updated_at = ?
      WHERE teacher_registrations.status = 'pending'`)
      .bind(crypto.randomUUID(), signup.authSubject, email, parsed.data.name, parsed.data.professionalTitle || "Репетитор", now + 24 * 60 * 60 * 1000, now).run();
  } catch (error) {
    const existing = await db.prepare("SELECT id FROM teacher_registrations WHERE lower(email) = lower(?) LIMIT 1").bind(email).first();
    if (!existing) {
      console.error(JSON.stringify({ event: "teacher_registration_persistence_failed", error: error instanceof Error ? error.message : "unknown" }));
      return Response.json({ error: "Регистрация временно недоступна" }, { status: 503 });
    }
  }
  return acceptedResponse();
}
