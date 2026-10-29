import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { assertSameOrigin, getAuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { enforceNodeRateLimit } from "@/lib/node-rate-limit";
import {
  deleteMemberAvatar, getMemberAvatar, hasCurrentContentRulesAcceptance, lessonPhotoStorageConfigured,
  memberAvatarObjectKey, putMemberAvatar,
} from "@/lib/lesson-materials";
import { rejectReadOnlyWrite } from "@/lib/workspace-access";

export const runtime = "nodejs";
const MAX_AVATAR_INPUT_BYTES = 2 * 1024 * 1024;

export async function GET(request: Request) {
  try {
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const memberId = new URL(request.url).searchParams.get("memberId") ?? auth.memberId;
    const result = await getPostgresPool().query(`SELECT avatar_object_key FROM members
      WHERE id = $1 AND workspace_id = $2 LIMIT 1`, [memberId, auth.workspaceId]);
    const key = result.rows[0]?.avatar_object_key;
    if (!key) return Response.json({ error: "Фотография профиля не найдена" }, { status: 404 });
    const body = await getMemberAvatar(String(key));
    return new Response(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer, { headers: { "Content-Type": "image/webp", "Cache-Control": "private, max-age=86400", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    console.error("Failed to read member avatar", error);
    return Response.json({ error: "Не удалось загрузить фотографию профиля" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let uploadedKey: string | null = null;
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const readOnly = rejectReadOnlyWrite(request, auth);
    if (readOnly) return readOnly;
    if (!lessonPhotoStorageConfigured()) return Response.json({ error: "Хранилище фотографий ещё не настроено" }, { status: 503 });
    const limited = await enforceNodeRateLimit(request, "member_avatar_upload", 5, `${auth.workspaceId}:${auth.memberId}`);
    if (limited) return limited;
    if (!await hasCurrentContentRulesAcceptance(auth)) return Response.json({ error: "Сначала примите правила размещения контента" }, { status: 409 });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength && contentLength > MAX_AVATAR_INPUT_BYTES + 64 * 1024) return tooLarge();
    const file = (await request.formData()).get("file");
    if (!(file instanceof File) || !file.type.startsWith("image/")) return Response.json({ error: "Можно загрузить только изображение" }, { status: 415 });
    if (file.size < 1 || file.size > MAX_AVATAR_INPUT_BYTES) return tooLarge();
    let processed: Buffer;
    try {
      processed = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "warning", limitInputPixels: 25_000_000 })
        .rotate().resize(512, 512, { fit: "cover", position: "attention" }).webp({ quality: 82, effort: 4 }).toBuffer();
    } catch {
      return Response.json({ error: "Изображение повреждено или имеет неподдерживаемый формат" }, { status: 415 });
    }
    const old = await getPostgresPool().query("SELECT avatar_object_key FROM members WHERE id = $1 AND workspace_id = $2", [auth.memberId, auth.workspaceId]);
    uploadedKey = memberAvatarObjectKey(auth.workspaceId, auth.memberId, randomUUID());
    await putMemberAvatar(uploadedKey, processed);
    await getPostgresPool().query("UPDATE members SET avatar_object_key = $1, avatar_updated_at = now(), updated_at = now() WHERE id = $2 AND workspace_id = $3", [uploadedKey, auth.memberId, auth.workspaceId]);
    const replacedKey = old.rows[0]?.avatar_object_key ? String(old.rows[0].avatar_object_key) : null;
    if (replacedKey && replacedKey !== uploadedKey) await deleteMemberAvatar(replacedKey).catch((error) => console.warn("Failed to delete replaced avatar", error));
    uploadedKey = null;
    return Response.json({ ok: true });
  } catch (error) {
    if (uploadedKey) await deleteMemberAvatar(uploadedKey).catch(() => undefined);
    console.error("Failed to upload member avatar", error);
    return Response.json({ error: "Не удалось загрузить фотографию профиля" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    if (!assertSameOrigin(request)) return Response.json({ error: "Запрос отклонён" }, { status: 403 });
    const auth = await getAuthMember(request);
    if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
    const readOnly = rejectReadOnlyWrite(request, auth);
    if (readOnly) return readOnly;
    const old = await getPostgresPool().query("SELECT avatar_object_key FROM members WHERE id = $1 AND workspace_id = $2", [auth.memberId, auth.workspaceId]);
    const result = await getPostgresPool().query(`UPDATE members SET avatar_object_key = NULL, avatar_updated_at = now(), updated_at = now()
      WHERE id = $1 AND workspace_id = $2`, [auth.memberId, auth.workspaceId]);
    const key = old.rows[0]?.avatar_object_key;
    if (key) await deleteMemberAvatar(String(key)).catch((error) => console.warn("Failed to delete member avatar", error));
    return Response.json({ ok: Boolean(result.rowCount) });
  } catch (error) {
    console.error("Failed to delete member avatar", error);
    return Response.json({ error: "Не удалось удалить фотографию профиля" }, { status: 500 });
  }
}

function tooLarge() {
  return Response.json({ error: "Фотография профиля должна быть не больше 2 МБ" }, { status: 413 });
}
