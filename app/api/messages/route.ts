import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getAuthMember, assertSameOrigin } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import { readLimitedJson } from "@/lib/request-security";
import { guardianFromRow, speakerName } from "@/lib/guardian";
import { hasCurrentContentRulesAcceptance } from "@/lib/lesson-materials";

export const runtime = "nodejs";

// Imported accounts can retain identifiers from the previous platform, so member
// ids must not be restricted to UUIDs here.
const memberId = z.string().trim().min(1).max(128);
// A teacher may send a library material; the caption is then optional.
const sendSchema = z.object({ recipientId: memberId, body: z.string().trim().max(500), resourceId: z.string().trim().min(1).max(128).optional() }).strict()
  .refine((value) => value.body.length > 0 || value.resourceId, { message: "empty" });
const patchSchema = z.union([
  z.object({ peerId: memberId }).strict(),
  z.object({ action: z.literal("pin"), messageId: memberId, pinned: z.boolean() }).strict(),
]);

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
          COALESCE(NULLIF(latest.body, ''), latest_resource.title) AS last_message, latest.created_at AS last_at
        FROM members peer
        JOIN users account_user ON account_user.id = peer.user_id AND account_user.password_hash IS NOT NULL
        LEFT JOIN member_display_preferences pref ON pref.viewer_member_id = $2 AND pref.student_member_id = peer.id
        LEFT JOIN LATERAL (
          SELECT body, resource_id, created_at FROM direct_messages message
          WHERE message.workspace_id = $1 AND ((message.sender_member_id = $2 AND message.recipient_member_id = peer.id)
            OR (message.sender_member_id = peer.id AND message.recipient_member_id = $2))
          ORDER BY created_at DESC LIMIT 1
        ) latest ON true
        LEFT JOIN teacher_resources latest_resource ON latest_resource.id = latest.resource_id
        WHERE peer.workspace_id = $1 AND peer.status = 'active' AND peer.id <> $2
          AND (($3 = 'student' AND peer.role IN ('owner', 'teacher'))
            OR ($3 IN ('owner', 'teacher') AND peer.role = 'student'))
        ORDER BY latest.created_at DESC NULLS LAST, peer.display_name`, [auth.workspaceId, auth.memberId, auth.role]),
      // A student sees a material card only while the material is still shared with them.
      getPostgresPool().query(`SELECT message.id, message.sender_member_id, message.recipient_member_id, message.body, message.read_at,
          message.created_at, message.pinned_at, message.resource_id,
          resource.title AS resource_title, resource.content_type AS resource_content_type, resource.byte_size AS resource_byte_size,
          resource.status = 'active' AND ($3 <> 'student' OR EXISTS (
            SELECT 1 FROM student_resource_links link WHERE link.resource_id = resource.id AND link.student_id = $2)) AS resource_available
        FROM direct_messages message
        LEFT JOIN teacher_resources resource ON resource.id = message.resource_id AND resource.workspace_id = message.workspace_id
        WHERE message.workspace_id = $1 AND (message.sender_member_id = $2 OR message.recipient_member_id = $2)
        ORDER BY message.created_at DESC LIMIT 300`, [auth.workspaceId, auth.memberId, auth.role]),
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
        pinned: Boolean(row.pinned_at),
        // A deleted material leaves the card with «Материал удалён» (resource_id is cleared or the resource is inactive).
        material: row.resource_id ? {
          id: String(row.resource_id), title: String(row.resource_title), contentType: String(row.resource_content_type),
          byteSize: Number(row.resource_byte_size), available: Boolean(row.resource_available),
          url: `/api/teacher-materials/${encodeURIComponent(String(row.resource_id))}`,
        } : null,
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
    const resourceId = parsed.data.resourceId;
    if (resourceId) {
      if (auth.role === "student") return Response.json({ error: "Материалы отправляет преподаватель" }, { status: 403 });
      if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
      const resource = await getPostgresPool().query("SELECT id FROM teacher_resources WHERE id = $1 AND workspace_id = $2 AND status = 'active'", [resourceId, auth.workspaceId]);
      if (!resource.rowCount) return Response.json({ error: "Материал не найден" }, { status: 404 });
    }
    const hourly = await getPostgresPool().query(`SELECT count(*)::int AS count FROM direct_messages
      WHERE workspace_id = $1 AND sender_member_id = $2 AND created_at > now() - interval '1 hour'`, [auth.workspaceId, auth.memberId]);
    if (Number(hourly.rows[0]?.count ?? 0) >= 60) return Response.json({ error: "За час можно отправить не более 60 сообщений" }, { status: 429, headers: { "Retry-After": "3600" } });
    const message = await getPostgresPool().query(`INSERT INTO direct_messages
      (id, workspace_id, sender_member_id, recipient_member_id, body, resource_id) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at`, [randomUUID(), auth.workspaceId, auth.memberId, parsed.data.recipientId, parsed.data.body, resourceId ?? null]);
    if (resourceId) {
      // Sending a material grants access like «Выдать ученику»: no file copy, no extra storage.
      await getPostgresPool().query(`INSERT INTO student_resource_links (id, workspace_id, student_id, resource_id, shared_by_member_id)
        VALUES ($1, $2, $3, $4, $5) ON CONFLICT (student_id, resource_id) DO NOTHING`,
      [randomUUID(), auth.workspaceId, parsed.data.recipientId, resourceId, auth.memberId]);
      await getPostgresPool().query("UPDATE teacher_resources SET last_used_at = now() WHERE id = $1 AND workspace_id = $2", [resourceId, auth.workspaceId]);
    }
    await getPostgresPool().query(`INSERT INTO notifications
      (id, member_id, student_id, type, title, body)
      VALUES ($1, $2, $3, 'direct_message', 'Новое сообщение', $4)`, [
      randomUUID(),
      parsed.data.recipientId,
      auth.role === "student" ? auth.memberId : null,
      auth.role === "student" ? "Ученик отправил вам сообщение." : resourceId ? "Преподаватель отправил вам материал." : "Преподаватель отправил вам сообщение.",
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
    const parsed = patchSchema.safeParse(json.value);
    if (!parsed.success) return Response.json({ error: "Собеседник недоступен" }, { status: 404 });
    if ("action" in parsed.data) return pinMessage(auth, parsed.data.messageId, parsed.data.pinned);
    if (!await accessiblePeer(auth.workspaceId, auth.memberId, auth.role, parsed.data.peerId)) return Response.json({ error: "Собеседник недоступен" }, { status: 404 });
    await getPostgresPool().query(`UPDATE direct_messages SET read_at = now()
      WHERE workspace_id = $1 AND sender_member_id = $2 AND recipient_member_id = $3 AND read_at IS NULL`,
    [auth.workspaceId, parsed.data.peerId, auth.memberId]);
    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to mark direct messages read", error);
    return Response.json({ error: "Не удалось обновить сообщения" }, { status: 500 });
  }
}

// Either participant may pin; one pinned message per conversation, a new pin replaces the old one.
async function pinMessage(auth: { workspaceId: string; memberId: string }, messageId: string, pinned: boolean) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(`SELECT sender_member_id, recipient_member_id FROM direct_messages
      WHERE id = $1 AND workspace_id = $2 AND (sender_member_id = $3 OR recipient_member_id = $3) FOR UPDATE`, [messageId, auth.workspaceId, auth.memberId]);
    if (!found.rowCount) {
      await client.query("ROLLBACK");
      return Response.json({ error: "Сообщение не найдено" }, { status: 404 });
    }
    const { sender_member_id: a, recipient_member_id: b } = found.rows[0];
    if (pinned) await client.query(`UPDATE direct_messages SET pinned_at = NULL WHERE workspace_id = $1 AND pinned_at IS NOT NULL
      AND ((sender_member_id = $2 AND recipient_member_id = $3) OR (sender_member_id = $3 AND recipient_member_id = $2))`, [auth.workspaceId, a, b]);
    await client.query("UPDATE direct_messages SET pinned_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1", [messageId, pinned]);
    await client.query("COMMIT");
    return Response.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function initials(name: string) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}
