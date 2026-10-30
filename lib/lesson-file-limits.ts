// Limits for files a student adds to lessons (audio recordings, documents, photos): per student
// per Moscow day. Teachers are bounded by the workspace quota and the hourly upload limit.
export const STUDENT_DAILY_LIMITS = { audio: 3, document: 3, photo: 10 } as const;
export const MAX_LESSON_AUDIO_BYTES = 20 * 1024 * 1024;
export const MAX_LESSON_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const lessonFileKind = (contentType: string) => contentType.startsWith("audio/") ? "audio" : "document";

/** SQL condition: created since the start of today in Moscow. */
export const SINCE_MOSCOW_TODAY = "created_at >= ((now() AT TIME ZONE 'Europe/Moscow')::date::timestamp AT TIME ZONE 'Europe/Moscow')";
