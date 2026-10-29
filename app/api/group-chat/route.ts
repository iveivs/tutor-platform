import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getPostgresPool } from "@/db/postgres";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";
import { rejectReadOnlyWrite } from "@/lib/workspace-access";

export const runtime = "nodejs";

// Group chat (variant B): «Объявления» written only by the teacher, and «Обсуждение» of the
// members, available only while the group's members see each other. Only current members and
// the workspace's teachers read it; a removed member loses access to the whole history.

type Auth = NonNullable<Awaited<ReturnType<typeof getAuthMember>>>;
type Kind = "announcement" | "discussion";

const MAX_ANNOUNCEMENT = 1000;
const MAX_DISCUSSION = 500;
const HISTORY_LIMIT = 200;
const id = z.string().trim().min(1).max(128);
const kind = z.enum(["announcement", "discussion"]);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send"), groupId: id, kind, body: z.string().trim().min(1).max(MAX_ANNOUNCEMENT) }).strict(),
  z.object({ action: z.literal("delete"), messageId: id }).strict(),
  z.object({ action: z.literal("pin"), messageId: id, pinned: z.boolean() }).strict(),
  z.object({ action: z.literal("mute"), groupId: id, memberId: id, muted: z.boolean() }).strict(),
  z.object({ action: z.literal("read"), groupId: id, kind }).strict(),
]);

const isTeacher = (auth: Auth) => auth.role === "owner" || auth.role === "teacher";

async function groupFor(auth: Auth, groupId: string) {
  const result = await getPostgresPool().query(`SELECT g.id, g.name, g.members_visible, g.status,
      membership.chat_muted, membership.member_id IS NOT NULL AS is_member,
      (SELECT count(*) FROM student_group_members m JOIN members student ON student.id = m.member_id
        WHERE m.group_id = g.id AND student.status <> 'archived')::int AS member_count
    FROM student_groups g
    LEFT JOIN student_group_members membership ON membership.group_id = g.id AND membership.member_id = $3
    WHERE g.id = $1 AND g.workspace_id = $2`, [groupId, auth.workspaceId, auth.memberId]);
  const group = result.rows[0];
  if (!group || (!isTeacher(auth) && !group.is_member)) return null;
  return {
    id: String(group.id), name: String(group.name), membersVisible: Boolean(group.members_visible), active: group.status === "active",
    muted: Boolean(group.chat_muted), memberCount: Number(group.member_count),
  };
}

// Unread counts of every group the member can open, for the badges on group cards.
async function unreadSummary(auth: Auth) {
  const result = await getPostgresPool().query(`SELECT g.id,
      count(message.id) FILTER (WHERE message.kind = 'announcement' AND message.created_at > COALESCE(ann.last_read_at, 'epoch'))::int AS announcement,
      count(message.id) FILTER (WHERE message.kind = 'discussion' AND g.members_visible AND message.created_at > COALESCE(disc.last_read_at, 'epoch'))::int AS discussion
    FROM student_groups g
    LEFT JOIN group_chat_reads ann ON ann.group_id = g.id AND ann.member_id = $2 AND ann.kind = 'announcement'
    LEFT JOIN group_chat_reads disc ON disc.group_id = g.id AND disc.member_id = $2 AND disc.kind = 'discussion'
    LEFT JOIN group_chat_messages message ON message.group_id = g.id AND message.deleted_at IS NULL AND message.author_member_id <> $2
    WHERE g.workspace_id = $1 AND g.status = 'active'
      AND ($3 OR EXISTS (SELECT 1 FROM student_group_members m WHERE m.group_id = g.id AND m.member_id = $2))
    GROUP BY g.id`, [auth.workspaceId, auth.memberId, isTeacher(auth)]);
  return result.rows.map((row) => ({ groupId: String(row.id), announcement: Number(row.announcement), discussion: Number(row.discussion) }));
}

export async function GET(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const groupId = new URL(request.url).searchParams.get("groupId");
  if (!groupId) return Response.json({ unread: await unreadSummary(auth) }, { headers: { "Cache-Control": "no-store" } });
  const group = await groupFor(auth, groupId);
  if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
  const teacher = isTeacher(auth);
  const pool = getPostgresPool();
  const [messages, reads, members] = await Promise.all([
    pool.query(`SELECT * FROM (SELECT message.id, message.kind, message.body, message.pinned, message.created_at, message.deleted_at,
        message.author_member_id, author.display_name AS author_name, author.role AS author_role
      FROM group_chat_messages message JOIN members author ON author.id = message.author_member_id
      WHERE message.group_id = $1 AND (message.kind = 'announcement' OR $2)
      ORDER BY message.created_at DESC LIMIT $3) recent ORDER BY created_at`, [group.id, group.membersVisible, HISTORY_LIMIT * 2]),
    pool.query("SELECT kind, last_read_at FROM group_chat_reads WHERE group_id = $1 AND member_id = $2", [group.id, auth.memberId]),
    teacher ? pool.query(`SELECT student.id, student.display_name, membership.chat_muted, ann.last_read_at AS announcements_read_at
      FROM student_group_members membership JOIN members student ON student.id = membership.member_id
      LEFT JOIN group_chat_reads ann ON ann.group_id = membership.group_id AND ann.member_id = student.id AND ann.kind = 'announcement'
      WHERE membership.group_id = $1 AND student.status <> 'archived' ORDER BY student.display_name`, [group.id]) : Promise.resolve(null),
  ]);
  const readAt = Object.fromEntries(reads.rows.map((row) => [row.kind, new Date(row.last_read_at).getTime()]));
  const memberReads = members?.rows.map((row) => row.announcements_read_at ? new Date(row.announcements_read_at).getTime() : 0) ?? [];
  return Response.json({
    group: { id: group.id, name: group.name, membersVisible: group.membersVisible, memberCount: group.memberCount, active: group.active },
    role: teacher ? "teacher" : "member",
    muted: group.muted,
    lastReadAt: { announcement: readAt.announcement ?? 0, discussion: readAt.discussion ?? 0 },
    messages: messages.rows.map((row) => {
      const createdAt = new Date(row.created_at).getTime();
      const deleted = Boolean(row.deleted_at);
      return {
        id: String(row.id), kind: String(row.kind) as Kind, pinned: Boolean(row.pinned), createdAt, deleted,
        body: deleted ? "" : String(row.body),
        mine: row.author_member_id === auth.memberId,
        author: { id: String(row.author_member_id), name: String(row.author_name), teacher: row.author_role !== "student" },
        // Only the teacher sees how many members have read an announcement.
        readCount: teacher && row.kind === "announcement" ? memberReads.filter((value) => value >= createdAt).length : undefined,
      };
    }),
    members: members?.rows.map((row) => ({ id: String(row.id), name: String(row.display_name), muted: Boolean(row.chat_muted), announcementsReadAt: row.announcements_read_at ? new Date(row.announcements_read_at).getTime() : null })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  const json = await readLimitedJson<unknown>(request);
  if (!json.ok) return json.response;
  const parsed = actionSchema.safeParse(json.value);
  if (!parsed.success) return Response.json({ error: "Проверьте текст сообщения" }, { status: 400 });
  const action = parsed.data;
  const pool = getPostgresPool();

  if (action.action === "read") {
    const group = await groupFor(auth, action.groupId);
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    await pool.query(`INSERT INTO group_chat_reads (group_id, member_id, kind, last_read_at) VALUES ($1, $2, $3, now())
      ON CONFLICT (group_id, member_id, kind) DO UPDATE SET last_read_at = now()`, [group.id, auth.memberId, action.kind]);
    return Response.json({ ok: true });
  }

  const readOnly = rejectReadOnlyWrite(request, auth);
  if (readOnly) return readOnly;
  const limited = await enforceNodeRateLimit(request, "group_chat", 20, `${auth.workspaceId}:${auth.memberId}`);
  if (limited) return limited;

  if (action.action === "send") {
    const group = await groupFor(auth, action.groupId);
    if (!group) return Response.json({ error: "Группа не найдена" }, { status: 404 });
    if (!group.active) return Response.json({ error: "Группа в архиве" }, { status: 409 });
    if (action.kind === "announcement" && !isTeacher(auth)) return Response.json({ error: "Объявления пишет преподаватель" }, { status: 403 });
    if (action.kind === "discussion") {
      if (!group.membersVisible) return Response.json({ error: "В этой группе участники не видят друг друга, обсуждение выключено" }, { status: 409 });
      if (group.muted) return Response.json({ error: "Преподаватель ограничил вам сообщения в этой группе" }, { status: 403 });
      if (action.body.length > MAX_DISCUSSION) return Response.json({ error: "Сообщение должно содержать от 1 до 500 символов" }, { status: 400 });
    }
    const hourly = await pool.query("SELECT count(*)::int AS count FROM group_chat_messages WHERE author_member_id = $1 AND created_at > now() - interval '1 hour'", [auth.memberId]);
    if (Number(hourly.rows[0]?.count ?? 0) >= 60) return Response.json({ error: "За час можно отправить не более 60 сообщений" }, { status: 429, headers: { "Retry-After": "3600" } });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const messageId = randomUUID();
      await client.query(`INSERT INTO group_chat_messages (id, workspace_id, group_id, author_member_id, kind, body) VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, auth.workspaceId, group.id, auth.memberId, action.kind, action.body]);
      await client.query(`INSERT INTO group_chat_reads (group_id, member_id, kind, last_read_at) VALUES ($1, $2, $3, now())
        ON CONFLICT (group_id, member_id, kind) DO UPDATE SET last_read_at = now()`, [group.id, auth.memberId, action.kind]);
      // Every announcement is an in-app notification for each member; the triggers add Telegram and push.
      // Discussion messages only raise the unread counter, so a busy group does not flood phones.
      if (action.kind === "announcement") {
        await client.query(`INSERT INTO notifications (id, member_id, type, title, body)
          SELECT gen_random_uuid()::text, membership.member_id, 'group_announcement', $2, $3
          FROM student_group_members membership JOIN members student ON student.id = membership.member_id
          WHERE membership.group_id = $1 AND student.status = 'active'`,
          [group.id, `Объявление: ${group.name}`, action.body.length > 300 ? `${action.body.slice(0, 297)}…` : action.body]);
      }
      await client.query("COMMIT");
      return Response.json({ ok: true, id: messageId });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  if (action.action === "mute") {
    if (!isTeacher(auth)) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    const result = await pool.query(`UPDATE student_group_members SET chat_muted = $1 WHERE group_id = $2 AND member_id = $3 AND workspace_id = $4`,
      [action.muted, action.groupId, action.memberId, auth.workspaceId]);
    if (!result.rowCount) return Response.json({ error: "Участник не найден" }, { status: 404 });
    return Response.json({ ok: true });
  }

  const found = await pool.query(`SELECT id, group_id, author_member_id, kind, deleted_at FROM group_chat_messages WHERE id = $1 AND workspace_id = $2`, [action.messageId, auth.workspaceId]);
  const message = found.rows[0];
  if (!message || message.deleted_at || !await groupFor(auth, String(message.group_id))) return Response.json({ error: "Сообщение не найдено" }, { status: 404 });

  if (action.action === "delete") {
    if (!isTeacher(auth) && message.author_member_id !== auth.memberId) return Response.json({ error: "Недостаточно прав" }, { status: 403 });
    await pool.query("UPDATE group_chat_messages SET deleted_at = now(), deleted_by_member_id = $2, pinned = false WHERE id = $1", [message.id, auth.memberId]);
    return Response.json({ ok: true });
  }

  if (!isTeacher(auth) || message.kind !== "announcement") return Response.json({ error: "Закрепить можно только объявление" }, { status: 403 });
  const client = await pool.connect();
  try {
    // One pinned announcement per group: pinning a new one unpins the previous.
    await client.query("BEGIN");
    if (action.pinned) await client.query("UPDATE group_chat_messages SET pinned = false WHERE group_id = $1 AND pinned", [message.group_id]);
    await client.query("UPDATE group_chat_messages SET pinned = $2 WHERE id = $1", [message.id, action.pinned]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return Response.json({ ok: true });
}
