import "server-only";

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { AuthMember } from "@/lib/auth";
import { getPostgresPool } from "@/db/postgres";
import { CONTENT_RULES_VERSION } from "@/lib/legal-consent";

export const MAX_NOTE_LENGTH = 4_000;
export const MAX_PHOTOS_PER_LESSON_MEMBER = 5;
export const MAX_PHOTO_INPUT_BYTES = 5 * 1024 * 1024;
export const MAX_WORKSPACE_PHOTO_BYTES = 500 * 1024 * 1024;
export const PHOTO_RETENTION_DAYS = 90;

type LessonAccess = {
  lessonId: string;
  studentId: string;
  endsAt: Date;
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
    prefix: (process.env.S3_PHOTOS_PREFIX?.trim() || "tutor-platform/lesson-photos").replace(/^\/+|\/+$/g, ""),
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
  return { client: s3Client, bucket: config.bucket, prefix: config.prefix };
}

export function lessonPhotoObjectKey(workspaceId: string, lessonId: string, attachmentId: string) {
  const { prefix } = client();
  return `${prefix}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(lessonId)}/${attachmentId}.webp`;
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

export async function hasCurrentContentRulesAcceptance(auth: AuthMember) {
  const result = await getPostgresPool().query(`SELECT 1 FROM legal_acceptances
    WHERE user_id = $1 AND member_id = $2 AND document_type = 'content_rules' AND document_version = $3 LIMIT 1`,
  [auth.userId, auth.memberId, CONTENT_RULES_VERSION]);
  return Boolean(result.rowCount);
}

export async function resolveLessonAccess(auth: AuthMember, requestedLessonId: string): Promise<LessonAccess | null> {
  const result = await getPostgresPool().query(`SELECT canonical.id, canonical.student_id,
      COALESCE((SELECT max(peer.ends_at) FROM lessons peer WHERE requested.group_id IS NOT NULL AND peer.group_id = requested.group_id), canonical.ends_at) AS ends_at
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
  return row ? { lessonId: String(row.id), studentId: String(row.student_id), endsAt: new Date(row.ends_at) } : null;
}

export function photoExpiresAt(lessonEndsAt: Date) {
  return new Date(lessonEndsAt.getTime() + PHOTO_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}
