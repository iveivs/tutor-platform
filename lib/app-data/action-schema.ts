import { z } from "zod";

const id = z.string().min(1).max(128);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.number().int().min(15).max(240).optional();
const lessonCount = z.union([z.literal(1), z.literal(2)]).optional();
const avatarColor = z.enum(["indigo", "violet", "rose", "amber", "emerald", "cyan", "slate"]);
const email = z.union([z.literal(""), z.string().email().max(254)]).optional();
export const actionBodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createLesson"), studentId: id.optional(), trialGuestName: z.string().trim().min(1).max(80).optional(), trialGuestEmail: email, trialGuestPhone: z.string().trim().max(40).optional(), trialGuestNote: z.string().trim().max(300).optional(), date, time, durationMinutes: duration, lessonCount, lessonType: z.enum(["regular", "trial"]).optional(), repeat: z.enum(["once", "weekly"]).optional() }).strict(),
  z.object({ action: z.literal("updateLesson"), lessonId: id, date, time, durationMinutes: duration }).strict(),
  z.object({ action: z.literal("deleteLesson"), lessonId: id }).strict(),
  z.object({ action: z.literal("stopLessonSeries"), seriesId: id }).strict(),
  z.object({ action: z.literal("createStudent"), name: z.string().trim().min(1).max(80), email, floating: z.boolean(), weekday: z.number().int().min(1).max(7).optional(), time: time.optional(), durationMinutes: duration }).strict(),
  z.object({ action: z.literal("updateStudent"), studentId: id, name: z.string().trim().min(1).max(80), email, canViewAvailability: z.boolean() }).strict(),
  z.object({ action: z.literal("convertTrialContact"), studentId: id }).strict(),
  z.object({ action: z.literal("archiveStudent"), studentId: id }).strict(),
  z.object({ action: z.literal("restoreStudent"), studentId: id }).strict(),
  z.object({ action: z.literal("deleteStudent"), studentId: id }).strict(),
  z.object({ action: z.literal("createStudentInvite"), studentId: id }).strict(),
  z.object({ action: z.literal("addPayment"), studentId: id, count: z.number().int().min(1).max(100), paymentDate: date.optional() }).strict(),
  z.object({ action: z.literal("adjustBalance"), studentId: id, units: z.number().int().min(-100).max(100).refine((value) => value !== 0), note: z.string().trim().min(3).max(200) }).strict(),
  z.object({ action: z.literal("reversePayment"), paymentId: id }).strict(),
  z.object({ action: z.literal("resolveRequest"), requestId: id, decision: z.enum(["approved", "declined"]) }).strict(),
  z.object({ action: z.literal("submitStudentRequest"), requestType: z.enum(["cancel", "reschedule", "new_lesson"]), lessonId: id.optional(), proposedDate: date.optional(), proposedTime: time.optional(), lessonCount, message: z.string().trim().max(500).optional(), studentId: id.optional() }).strict(),
  z.object({ action: z.literal("updateProfile"), name: z.string().trim().min(2).max(80), professionalTitle: z.string().trim().max(50) }).strict(),
  z.object({ action: z.literal("replaceAvailability"), windows: z.array(z.object({ weekday: z.number().int().min(1).max(7), start: time, end: time }).strict()).max(50) }).strict(),
  z.object({ action: z.literal("markNotificationsRead"), notificationId: id.optional() }).strict(),
  z.object({ action: z.literal("updateOwnAvatarColor"), color: avatarColor }).strict(),
  z.object({ action: z.literal("updateStudentAvatarColor"), studentId: id, color: avatarColor.nullable() }).strict(),
]);
export type ActionBody = z.infer<typeof actionBodySchema>;
