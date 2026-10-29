import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAuthMember, assertSameOrigin } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";
import { guardianFromRow, speakerName } from "@/lib/guardian";

export const runtime = "nodejs";

// Imported accounts can retain identifiers from the previous platform, so member
// ids must not be restricted to UUIDs here.
const memberId = z.string().trim().min(1).max(128);
const sendSchema = z.object({ recipientId: memberId, body: z.string().trim().min(1).max(500) }).strict();
const readSchema = z.object({ peerId: memberId }).strict();

async function accessiblePeer(workspaceId: string, memberId: string, role: string, peerId: string) {
  const result = await getPostgresPool().query(`SELECT peer.id
    FROM members peer
    JOIN users account_user ON account_user.id = peer.user_id AND account_user.password_hash IS NOT NULL
    WHERE peer.id = $1 AND peer.workspace_id = $2 AND peer.status = 'active' AND peer.id <> $3
      AND (($4 = 'student' AND peer.role IN ('owner', 'teacher'))
        OR ($4 IN ('owner', 'teacher') AND peer.role = 'student'))
    LIMIT 1`, [peerId, workspaceId, memberId, role]);
  return Boolean(result.rowCount);
}

export async function GET(request: Request) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const [peers, messages] = await Promise.all([
      getPostgresPool().query(`SELECT peer.id, peer.display_name, peer.role, peer.avatar_color, peer.guardian_name, peer.guardian_relation, peer.guardian_relation_other,
          peer.avatar_object_key IS NOT NULL AS has_avatar, peer.avatar_updated_at,
          COALESCE(pref.avatar_color, peer.avatar_color) AS effective_avatar_color,
          (SELECT count(*)::int FROM direct_messages unread
            WHERE unread.sender_member_id = peer.id AND unread.recipient_member_id = $2 AND unread.read_at IS NULL) AS unread_count,
          latest.body AS last_message, latest.created_at AS last_at
        FROM members peer
        JOIN users account_user ON account_user.id = peer.user_id AND account_user.password_hash IS NOT NULL
        LEFT JOIN member_display_preferences pref ON pref.viewer_member_id = $2 AND pref.student_member_id = peer.id
        LEFT JOIN LATERAL (
          SELECT body, created_at FROM direct_messages message
          WHERE message.workspace_id = $1 AND ((message.sender_member_id = $2 AND message.recipient_member_id = peer.id)
            OR (message.sender_member_id = peer.id AND message.recipient_member_id = $2))
          ORDER BY created_at DESC LIMIT 1
        ) latest ON true
        WHERE peer.workspace_id = $1 AND peer.status = 'active' AND peer.id <> $2
          AND (($3 = 'student' AND peer.role IN ('owner', 'teacher'))
            OR ($3 IN ('owner', 'teacher') AND peer.role = 'student'))
        ORDER BY latest.created_at DESC NULLS LAST, peer.display_name`, [auth.workspaceId, auth.memberId, auth.role]),
      getPostgresPool().query(`SELECT id, sender_member_id, recipient_member_id, body, read_at, created_at
        FROM direct_messages WHERE workspace_id = $1 AND (sender_member_id = $2 OR recipient_member_id = $2)
        ORDER BY created_at DESC LIMIT 300`, [auth.workspaceId, auth.memberId]),
    ]);
    return Response.json({
      currentMemberId: auth.memberId,
      peers: peers.rows.map((row) => ({
        id: String(row.id), name: speakerName(String(row.display_name), guardianFromRow(row)), role: String(row.role),
        initials: initials(String(row.display_name)), avatarColor: String(row.effective_avatar_color),
        avatarUrl: row.has_avatar ? `/api/profile/avatar?memberId=${encodeURIComponent(String(row.id))}&v=${new Date(row.avatar_updated_at).getTime()}` : null,
        unreadCount: Number(row.unread_count), lastMessage: row.last_message ? String(row.last_message) : null,
        lastAt: row.last_at ? new Date(row.last_at).getTime() : null,
      })),
      messages: messages.rows.reverse().map((row) => ({
        id: String(row.id), senderId: String(row.sender_member_id), recipientId: String(row.recipient_member_id),
        body: String(row.body), read: Boolean(row.read_at), createdAt: new Date(row.created_at).getTime(),
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read direct messages", error);
    return Response.json({ error: "Не удалось загрузить сообщения" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const limited = await enforceNodeRateLimit(request, "direct_message", 10, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = sendSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "Сообщение должно содержать от 1 до 500 символов" }, { status: 400 });
    if (!await accessiblePeer(auth.workspaceId, auth.memberId, auth.role, parsed.data.recipientId)) return Response.json({ error: "Собеседник недоступен" }, { status: 404 });
    const hourly = await getPostgresPool().query(`SELECT count(*)::int AS count FROM direct_messages
      WHERE workspace_id = $1 AND sender_member_id = $2 AND created_at > now() - interval '1 hour'`, [auth.workspaceId, auth.memberId]);
    if (Number(hourly.rows[0]?.count ?? 0) >= 60) return Response.json({ error: "За час можно отправить не более 60 сообщений" }, { status: 429, headers: { "Retry-After": "3600" } });
    const message = await getPostgresPool().query(`INSERT INTO direct_messages
      (id, workspace_id, sender_member_id, recipient_member_id, body) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, created_at`, [randomUUID(), auth.workspaceId, auth.memberId, parsed.data.recipientId, parsed.data.body]);
    await getPostgresPool().query(`INSERT INTO notifications
      (id, member_id, student_id, type, title, body)
      VALUES ($1, $2, $3, 'direct_message', 'Новое сообщение', $4)`, [
      randomUUID(),
      parsed.data.recipientId,
      auth.role === "student" ? auth.memberId : null,
      auth.role === "student" ? "Ученик отправил вам сообщение." : "Преподаватель отправил вам сообщение.",
    ]);
    return Response.json({ ok: true, id: message.rows[0].id, createdAt: new Date(message.rows[0].created_at).getTime() });
  } catch (error) {
    console.error("Failed to send direct message", error);
    return Response.json({ error: "Не удалось отправить сообщение" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const json = await readLimitedJson<unknown>(request);
    if (!json.ok) return json.response;
    const parsed = readSchema.safeParse(json.value);
    if (!parsed.success || !await accessiblePeer(auth.workspaceId, auth.memberId, auth.role, parsed.data.peerId)) return Response.json({ error: "Собеседник недоступен" }, { status: 404 });
    await getPostgresPool().query(`UPDATE direct_messages SET read_at = now()
      WHERE workspace_id = $1 AND sender_member_id = $2 AND recipient_member_id = $3 AND read_at IS NULL`,
    [auth.workspaceId, parsed.data.peerId, auth.memberId]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to mark direct messages read", error);
    return Response.json({ error: "Не удалось обновить сообщения" }, { status: 500 });
  }
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
