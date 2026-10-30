import { getPostgresPool } from "@/db/postgres";

// Fair-use caps behind «ученики без ограничений»: no real tutor reaches them, but they stop
// a script from filling the database or sending mass invitation e-mails from one workspace.
export const MAX_ACTIVE_STUDENTS = 300;
export const MAX_NEW_STUDENTS_PER_DAY = 50;
export const MAX_INVITATIONS_PER_DAY = 30;

const tooMany = (error: string) => Response.json({ error }, { status: 429, headers: { "Retry-After": "3600" } });

/** Checks before a new student card or trial contact is created. */
export async function studentLimitResponse(workspaceId: string) {
  const result = await getPostgresPool().query<{ active: number; recent: number }>(`SELECT
      count(*) FILTER (WHERE status <> 'archived')::int AS active,
      count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS recent
    FROM members WHERE workspace_id = $1 AND role = 'student'`, [workspaceId]);
  const { active = 0, recent = 0 } = result.rows[0] ?? {};
  if (active >= MAX_ACTIVE_STUDENTS) return tooMany(`В кабинете уже ${MAX_ACTIVE_STUDENTS} активных учеников. Перенесите неактивных в архив или напишите в поддержку`);
  if (recent >= MAX_NEW_STUDENTS_PER_DAY) return tooMany("Сегодня добавлено слишком много учеников. Продолжите завтра или напишите в поддержку");
  return null;
}

/** Checks before an invitation e-mail is sent. */
export async function invitationLimitResponse(workspaceId: string) {
  const result = await getPostgresPool().query<{ recent: number }>(`SELECT count(*)::int AS recent FROM invitations
    WHERE workspace_id = $1 AND created_at > now() - interval '1 day'`, [workspaceId]);
  if ((result.rows[0]?.recent ?? 0) >= MAX_INVITATIONS_PER_DAY) return tooMany("Сегодня отправлено слишком много приглашений. Продолжите завтра");
  return null;
}
