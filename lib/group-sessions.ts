import type { GroupAbsence, Lesson } from "@/components/features/app/types";

// The schedule shows a group session as one card: member rows with the same group and start are merged.
// Individual lessons pass through unchanged.
export function combineGroupSessions(lessons: Lesson[], absences: GroupAbsence[]): Lesson[] {
  const sessions = new Map<string, Lesson>();
  const result: Lesson[] = [];
  for (const lesson of lessons) {
    if (!lesson.classId) { result.push(lesson); continue; }
    const key = `${lesson.classId}:${lesson.date}:${lesson.time}`;
    const participant = { lessonId: lesson.id, studentId: lesson.studentId, name: lesson.name, status: lesson.status, label: lesson.label };
    const session = sessions.get(key);
    if (session) { session.participants = [...(session.participants ?? []), participant]; continue; }
    const combined: Lesson = { ...lesson, name: lesson.className ?? lesson.name, participants: [participant], absentees: [] };
    sessions.set(key, combined);
    result.push(combined);
  }
  for (const absence of absences) {
    const start = new Date(absence.startsAt);
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(start);
    const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Moscow" }).format(start);
    const session = sessions.get(`${absence.classId}:${date}:${time}`);
    if (session) session.absentees = [...(session.absentees ?? []), absence];
  }
  return result;
}
