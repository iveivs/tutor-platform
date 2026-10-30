import "server-only";
import { randomUUID } from "node:crypto";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";

export const MAX_NOTE_LENGTH = 4_000;
export const MAX_PHOTOS_PER_LESSON_MEMBER = 5;
export const MAX_PHOTO_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_PHOTO_BYTES = 500 * 1024 * 1024;
export const PHOTO_RETENTION_DAYS = 90;

// For a group session the teacher's content (notes, documents, photos, homework) lives on one "anchor" row of the
// session (the earliest created); every member reads it from there, while their own notes, photos and answers stay on their row.
export type LessonAccess = {
  lessonId: string;
  studentId: string;
  endsAt: Date;
  /** Set for a group session the viewer may see as a whole (the teacher, or a current member). */
  session: { classId: string; startsAt: Date; anchorLessonId: string } | null;
};

let s3Client: S3Client | null = null;

function required(value: string | undefined, name: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is not configured`);
  return normalized;
}

export function lessonPhotoStorageConfigured() {
  return Boolean(process.env.S3_ENDPOINT?.trim() && process.env.S3_BUCKET?.trim() && process.env.S3_ACCESS_KEY_ID?.trim() && process.env.S3_SECRET_ACCESS_KEY?.trim());
}

function storageConfig() {
  const configuredRegion = process.env.S3_REGION?.trim();
  return {
    endpoint: required(process.env.S3_ENDPOINT, "S3_ENDPOINT"),
    bucket: required(process.env.S3_BUCKET, "S3_BUCKET"),
    region: configuredRegion && configuredRegion !== "auto" ? configuredRegion : "ru-1",
    accessKeyId: required(process.env.S3_ACCESS_KEY_ID, "S3_ACCESS_KEY_ID"),
    secretAccessKey: required(process.env.S3_SECRET_ACCESS_KEY, "S3_SECRET_ACCESS_KEY"),
    photosPrefix: (process.env.S3_PHOTOS_PREFIX?.trim() || "tutor-platform/lesson-photos").replace(/^\/+|\/+$/g, ""),
    materialsPrefix: (process.env.S3_MATERIALS_PREFIX?.trim() || "tutor-platform/teacher-materials").replace(/^\/+|\/+$/g, ""),
    avatarsPrefix: (process.env.S3_AVATARS_PREFIX?.trim() || "tutor-platform/member-avatars").replace(/^\/+|\/+$/g, ""),
  };
}

function client() {
  const config = storageConfig();
  s3Client ??= new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return { client: s3Client, bucket: config.bucket, photosPrefix: config.photosPrefix, materialsPrefix: config.materialsPrefix, avatarsPrefix: config.avatarsPrefix };
}

export function lessonPhotoObjectKey(workspaceId: string, lessonId: string, attachmentId: string) {
  const { photosPrefix } = client();
  return `${photosPrefix}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(lessonId)}/${attachmentId}.webp`;
}

// Lesson files live next to lesson photos: both are temporary and removed 90 days after the lesson.
export function lessonFileObjectKey(workspaceId: string, lessonId: string, fileId: string, extension: string) {
  const { photosPrefix } = client();
  return `${photosPrefix}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(lessonId)}/files/${fileId}.${extension}`;
}

export async function putLessonFile(objectKey: string, body: Uint8Array, contentType: string) {
  const storage = client();
  await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: body, ContentType: contentType, CacheControl: "private, max-age=86400", Metadata: { retention: `${PHOTO_RETENTION_DAYS}-days` } }));
}

export async function getLessonFile(objectKey: string, range?: { start: number; end: number }) {
  const storage = client();
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey, Range: range ? `bytes=${range.start}-${range.end}` : undefined }));
  if (!result.Body) throw new Error("S3 object body is empty");
  return result.Body.transformToByteArray();
}

export function teacherMaterialObjectKey(workspaceId: string, resourceId: string, extension: string) {
  const { materialsPrefix } = client();
  return `${materialsPrefix}/${encodeURIComponent(workspaceId)}/${resourceId}.${extension}`;
}

export function memberAvatarObjectKey(workspaceId: string, memberId: string, avatarId: string) {
  const { avatarsPrefix } = client();
  return `${avatarsPrefix}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(memberId)}/${avatarId}.webp`;
}

export async function putLessonPhoto(objectKey: string, body: Uint8Array) {
  const storage = client();
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: body,
    ContentType: "image/webp",
    CacheControl: "private, max-age=86400",
    Metadata: { retention: `${PHOTO_RETENTION_DAYS}-days` },
  }));
}

export async function getLessonPhoto(objectKey: string) {
  const storage = client();
  const result = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  if (!result.Body) throw new Error("S3 object body is empty");
  return result.Body.transformToByteArray();
}

export async function deleteLessonPhoto(objectKey: string) {
  const storage = client();
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
}

export async function putMemberAvatar(objectKey: string, body: Uint8Array) {
  const storage = client();
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: body,
    ContentType: "image/webp",
    CacheControl: "private, max-age=86400",
    Metadata: { kind: "member-avatar" },
  }));
}

export async function getMemberAvatar(objectKey: string) {
  return getLessonPhoto(objectKey);
}

export async function deleteMemberAvatar(objectKey: string) {
  return deleteLessonPhoto(objectKey);
}

export async function putTeacherMaterial(objectKey: string, body: Uint8Array, contentType: string, contentSha256: string) {
  const storage = client();
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Body: body,
    ContentType: contentType,
    CacheControl: "private, no-store",
    Metadata: { sha256: contentSha256, kind: "teacher-material" },
  }));
}

export async function getTeacherMaterial(objectKey: string, range?: { start: number; end: number }) {
  const storage = client();
  const result = await storage.client.send(new GetObjectCommand({
    Bucket: storage.bucket,
    Key: objectKey,
    Range: range ? `bytes=${range.start}-${range.end}` : undefined,
  }));
  if (!result.Body) throw new Error("S3 object body is empty");
  return result.Body.transformToByteArray();
}

export async function deleteTeacherMaterial(objectKey: string) {
  const storage = client();
  await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
}

export async function hasCurrentContentRulesAcceptance(auth: AuthMember) {
  const result = await getPostgresPool().query(`SELECT 1 FROM legal_acceptances
    WHERE user_id = $1 AND member_id = $2 AND document_type = 'content_rules' AND document_version = $3 LIMIT 1`,
  [auth.userId, auth.memberId, CONTENT_RULES_VERSION]);
  return Boolean(result.rowCount);
}

export async function resolveLessonAccess(auth: AuthMember, requestedLessonId: string): Promise<LessonAccess | null> {
  const result = await getPostgresPool().query(`SELECT canonical.id, canonical.student_id,
      COALESCE((SELECT max(peer.ends_at) FROM lessons peer WHERE requested.group_id IS NOT NULL AND peer.group_id = requested.group_id), canonical.ends_at) AS ends_at,
      requested.class_id, requested.starts_at,
      (SELECT anchor.id FROM lessons anchor WHERE anchor.workspace_id = requested.workspace_id AND anchor.class_id = requested.class_id AND anchor.starts_at = requested.starts_at
        ORDER BY anchor.created_at, anchor.id LIMIT 1) AS anchor_id,
      ($3 <> 'student' OR EXISTS (SELECT 1 FROM student_group_members member WHERE member.group_id = requested.class_id AND member.member_id = $4)) AS session_visible
    FROM lessons requested
    JOIN LATERAL (
      SELECT candidate.id, candidate.student_id, candidate.ends_at
      FROM lessons candidate
      WHERE candidate.workspace_id = requested.workspace_id
        AND (candidate.id = requested.id OR (requested.group_id IS NOT NULL AND candidate.group_id = requested.group_id))
      ORDER BY candidate.starts_at, candidate.id LIMIT 1
    ) canonical ON true
    WHERE requested.id = $1 AND requested.workspace_id = $2
      AND ($3 <> 'student' OR requested.student_id = $4)
    LIMIT 1`, [requestedLessonId, auth.workspaceId, auth.role, auth.memberId]);
  const row = result.rows[0];
  if (!row) return null;
  const session = row.class_id && row.anchor_id && row.session_visible ? { classId: String(row.class_id), startsAt: new Date(row.starts_at), anchorLessonId: String(row.anchor_id) } : null;
  // The teacher always writes a group session's content to its anchor row; a student writes to their own row.
  return { lessonId: session && auth.role !== "student" ? session.anchorLessonId : String(row.id), studentId: String(row.student_id), endsAt: new Date(row.ends_at), session };
}

/** SQL condition: the student (`studentParam`) may see teacher content on `lesson` — their own row, or a group session they belong to. */
export function studentSeesLessonSql(lesson: string, studentParam: string) {
  return `(${lesson}.student_id = ${studentParam} OR (${lesson}.class_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM lessons own JOIN student_group_members member ON member.group_id = own.class_id AND member.member_id = own.student_id
    WHERE own.student_id = ${studentParam} AND own.class_id = ${lesson}.class_id AND own.starts_at = ${lesson}.starts_at)))`;
}

/** Lesson rows whose teacher-made content this viewer sees: the lesson itself, or the whole group session. */
export async function sessionLessonIds(workspaceId: string, access: LessonAccess) {
  if (!access.session) return [access.lessonId];
  const result = await getPostgresPool().query("SELECT id FROM lessons WHERE workspace_id = $1 AND class_id = $2 AND starts_at = $3", [workspaceId, access.session.classId, access.session.startsAt]);
  return [...new Set([access.lessonId, ...result.rows.map((row) => String(row.id))])];
}

/** Tell every student of the lesson (each member of a group session, on their own row) about new teacher content. */
export async function notifyLessonStudents(workspaceId: string, access: LessonAccess, type: string, title: string, body: string) {
  for (const target of await lessonAudience(workspaceId, access)) {
    await getPostgresPool().query(`INSERT INTO notifications (id, member_id, student_id, lesson_id, type, title, body) VALUES ($1, $2, $2, $3, $4, $5, $6)`,
      [randomUUID(), target.studentId, target.lessonId, type, title, body]);
  }
}

/** Students to notify about teacher-made content, each with their own lesson row. */
export async function lessonAudience(workspaceId: string, access: LessonAccess) {
  if (!access.session) return [{ studentId: access.studentId, lessonId: access.lessonId }];
  const result = await getPostgresPool().query(`SELECT lesson.id, lesson.student_id FROM lessons lesson
    JOIN student_group_members member ON member.group_id = lesson.class_id AND member.member_id = lesson.student_id
    WHERE lesson.workspace_id = $1 AND lesson.class_id = $2 AND lesson.starts_at = $3 AND lesson.status <> 'cancelled'`, [workspaceId, access.session.classId, access.session.startsAt]);
  return result.rows.map((row) => ({ studentId: String(row.student_id), lessonId: String(row.id) }));
}

export function photoExpiresAt(lessonEndsAt: Date) {
  return new Date(lessonEndsAt.getTime() + PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
