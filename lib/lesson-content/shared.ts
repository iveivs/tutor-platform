import { z } from "zod";
import { getAuthMember } from "@/lib/auth";
import { MAX_NOTE_LENGTH } from "@/lib/lesson-materials";
import { rejectReadOnlyWrite } from "@/lib/workspace-access";

export const lessonIdSchema = z.string().min(1).max(128);
export const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("acceptContentRules"), accepted: z.literal(true) }).strict(),
  z.object({ action: z.literal("upsertNote"), lessonId: lessonIdSchema, visibility: z.enum(["shared", "teacher_private"]), body: z.string().trim().min(1).max(MAX_NOTE_LENGTH) }).strict(),
  z.object({ action: z.literal("deleteNote"), noteId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("deleteAttachment"), attachmentId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("attachResource"), lessonId: lessonIdSchema, resourceId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("detachResource"), lessonId: lessonIdSchema, resourceId: z.string().uuid() }).strict(),
  z.object({ action: z.literal("updateHomework"), lessonId: lessonIdSchema, field: z.enum(["assignment", "student_response"]), body: z.string().max(MAX_NOTE_LENGTH) }).strict(),
]);

export async function requireAuth(request: Request) {
  const auth = await getAuthMember(request);
  if (!auth) return Response.json({ error: "Требуется вход" }, { status: 401 });
  return rejectReadOnlyWrite(request, auth) ?? auth;
}

export type LessonContentAuth = NonNullable<Awaited<ReturnType<typeof getAuthMember>>>;
export type LessonContentAction = z.infer<typeof actionSchema>;
