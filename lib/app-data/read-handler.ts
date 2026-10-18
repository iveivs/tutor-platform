import { getD1 } from "@/db/d1";
import { buildAvailableSlots } from "@/lib/availability";
import { getAuthConfig } from "@/lib/auth";
import {
  dateLabel,
  ensureSeriesLessons,
  formatHistoryLesson,
  groupLessonParts,
  historyMomentLabel,
  initials,
  invalid,
  minutesToTime,
  requireMember,
  timeLabel,
  toMoscowDate,
  type LessonPart,
} from "@/lib/app-data/route-utils";
import { groupDoubleLessonCharges, groupDoubleLessonEvents } from "@/lib/double-lesson-history";
import { collectChangedSections, incrementalDataSections, type IncrementalDataSection } from "@/lib/incremental-sync";
import { settlePastLessons } from "@/lib/lesson-maintenance";

export async function handleGetAppData(request: Request) {
  try {
    const auth = await requireMember(request);
    if (auth instanceof Response) return auth;
    const studentAccountReadySql = getAuthConfig()?.url === "postgresql"
      ? "EXISTS(SELECT 1 FROM users account_user WHERE account_user.id = m.user_id AND account_user.password_hash IS NOT NULL)"
      : "m.status = 'active'";
    const url = new URL(request.url);
    const includePastLessons = url.searchParams.get("includePastLessons") === "1";
    const cursorValue = url.searchParams.get("cursor");
    if (cursorValue !== null && !/^\d+$/.test(cursorValue)) return invalid();
    const requestedCursor = cursorValue === null ? null : Number(cursorValue);
    if (requestedCursor !== null && !Number.isSafeInteger(requestedCursor)) return invalid();
    const db = getD1();
    let sections = new Set<IncrementalDataSection>(incrementalDataSections);
    let syncCursor = 0;
    if (requestedCursor === null) {
      await ensureSeriesLessons(db, auth.workspaceId);
      await settlePastLessons(db, auth.workspaceId);
      const latest = await db.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM data_changes WHERE workspace_id = ? AND audience_member_id = ?")
        .bind(auth.workspaceId, auth.memberId).first<{ id: number }>();
      syncCursor = Number(latest?.id ?? 0);
    } else {
      const changedRows = await db.prepare(`SELECT sections, MAX(id) AS id FROM data_changes
        WHERE workspace_id = ? AND audience_member_id = ? AND id > ? GROUP BY sections`)
        .bind(auth.workspaceId, auth.memberId, requestedCursor).all<{ sections: string; id: number }>();
      if (!changedRows.results.length) return Response.json({ syncCursor: requestedCursor });
      const changed = collectChangedSections(changedRows.results, requestedCursor);
      sections = changed.sections;
      syncCursor = changed.cursor;
    }
    const ownStudentId = auth.role === "student" ? auth.memberId : null;
    const needs = (...values: IncrementalDataSection[]) => values.some((value) => sections.has(value));
    const availabilityAccess = auth.role !== "student" || !needs("availability") ? auth.role !== "student" : Boolean(await db.prepare("SELECT can_view_availability FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status = 'active'").bind(auth.memberId, auth.workspaceId).first<{ can_view_availability: number }>()?.then((row) => row?.can_view_availability));
    const availabilityHorizon = Date.now() + 16 * 24 * 60 * 60_000;
    const loadRows = (enabled: boolean, load: () => Promise<unknown>) => enabled
      ? load().then((result) => result as { results: Array<Record<string, unknown>> })
      : Promise.resolve({ results: [] as Array<Record<string, unknown>> });
    const [studentRows, seriesRows, lessonRows, requestRows, balanceRows, notificationRows, teacherRow, viewerRow, lessonEventRows, historyRequestRows, historyBalanceRows, availabilityRows, availabilityBusyRows] = await Promise.all([
      loadRows(needs("students"), () => db.prepare(`SELECT m.id, m.display_name, m.email, m.status, m.schedule_type, m.can_view_availability,
        m.avatar_color, m.avatar_object_key IS NOT NULL AS has_avatar, m.avatar_updated_at,
        (SELECT preference.avatar_color FROM member_display_preferences preference
          WHERE preference.viewer_member_id = ? AND preference.student_member_id = m.id LIMIT 1) AS avatar_override_color,
        ${studentAccountReadySql} AS account_ready,
        COALESCE((SELECT SUM(b.lesson_units) FROM balance_entries b WHERE b.student_id = m.id), 0) AS balance,
        NOT EXISTS(SELECT 1 FROM lessons paid WHERE paid.student_id = m.id AND paid.lesson_type = 'regular' AND paid.status = 'completed')
          AND NOT EXISTS(SELECT 1 FROM balance_entries payment WHERE payment.student_id = m.id AND payment.kind = 'payment') AS trial_eligible,
        (SELECT MIN(l.starts_at) FROM lessons l WHERE l.student_id = m.id AND l.status = 'scheduled' AND l.starts_at >= ?) AS next_lesson
        FROM members m
        WHERE m.workspace_id = ? AND m.role = 'student' AND m.is_trial_contact = 0 AND (? IS NULL OR m.id = ?)
        ORDER BY m.display_name`).bind(auth.memberId, Date.now(), auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("students", "lessons"), () => db.prepare(`SELECT id, student_id, weekday, start_minutes, duration_minutes FROM lesson_series
        WHERE workspace_id = ? AND is_active = 1 AND (? IS NULL OR student_id = ?) ORDER BY weekday, start_minutes`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("lessons"), () => db.prepare(`SELECT l.id, l.student_id, l.group_id, l.lesson_type, l.starts_at, l.ends_at, l.status AS lesson_status, m.display_name, m.is_trial_contact,
        COALESCE((SELECT SUM(be.lesson_units) FROM balance_entries be WHERE be.student_id = l.student_id), 0) AS balance,
        (EXISTS(SELECT 1 FROM lesson_resource_links link WHERE link.lesson_id = l.id)
          OR EXISTS(SELECT 1 FROM lesson_attachments attachment WHERE attachment.lesson_id = l.id AND attachment.status = 'active')) AS has_file,
        EXISTS(SELECT 1 FROM lesson_notes note WHERE note.lesson_id = l.id) AS has_note,
        (SELECT r.type FROM lesson_requests r LEFT JOIN lessons requested ON requested.id = r.lesson_id
          WHERE r.status = 'pending' AND (r.lesson_id = l.id OR (l.group_id IS NOT NULL AND requested.group_id = l.group_id))
          ORDER BY r.created_at LIMIT 1) AS request_type
        FROM lessons l JOIN members m ON m.id = l.student_id
        WHERE l.workspace_id = ?
          AND ((l.status = 'scheduled' AND l.ends_at > ?)
            OR (l.group_id IS NOT NULL AND l.status = 'completed' AND EXISTS (
              SELECT 1 FROM lessons peer WHERE peer.group_id = l.group_id AND peer.status = 'scheduled' AND peer.ends_at > ?
            ))
            OR (? = 1 AND l.status = 'completed'))
          AND (? IS NULL OR l.student_id = ?)
        ORDER BY l.starts_at`).bind(auth.workspaceId, Date.now(), Date.now(), includePastLessons ? 1 : 0, ownStudentId, ownStudentId).all()),
      loadRows(needs("requests"), () => db.prepare(`SELECT r.id, r.type, r.message, r.proposed_starts_at, r.proposed_ends_at, l.starts_at,
        m.display_name FROM lesson_requests r
        JOIN members m ON m.id = r.student_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND r.status = 'pending' AND (? IS NULL OR r.student_id = ?) ORDER BY r.created_at`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("balanceEntries"), () => db.prepare(`SELECT b.id, b.student_id, b.kind, b.lesson_units, b.note, b.occurred_at,
        EXISTS(SELECT 1 FROM balance_entries reversal WHERE reversal.reverses_entry_id = b.id) AS reversed
        FROM balance_entries b
        WHERE b.workspace_id = ? AND (? IS NULL OR b.student_id = ?) ORDER BY b.occurred_at DESC, b.created_at DESC`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("notifications"), () => db.prepare(`SELECT n.id, n.type, n.title, n.body, n.read_at, n.created_at,
        student.display_name AS student_name,
        request.type AS request_type, request.status AS request_status, request.message AS request_message,
        request.proposed_starts_at, request.proposed_ends_at,
        lesson.starts_at AS lesson_starts_at, lesson.ends_at AS lesson_ends_at,
        balance.lesson_units
        FROM notifications n
        LEFT JOIN lesson_requests request ON request.id = n.request_id
        LEFT JOIN lessons lesson ON lesson.id = COALESCE(n.lesson_id, request.lesson_id)
        LEFT JOIN balance_entries balance ON balance.id = n.balance_entry_id
        LEFT JOIN members student ON student.id = COALESCE(n.student_id, request.student_id, lesson.student_id, balance.student_id)
        WHERE n.member_id = ? ORDER BY n.created_at DESC LIMIT 30`).bind(auth.memberId).all()),
      needs("profile") ? db.prepare(`SELECT display_name, professional_title FROM members WHERE workspace_id = ? AND role IN ('owner', 'teacher') AND status = 'active'
        ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1`).bind(auth.workspaceId).first<{ display_name: string; professional_title: string }>() : Promise.resolve(null),
      needs("profile") ? db.prepare(`SELECT m.display_name, m.professional_title, COALESCE(m.email, u.email, '') AS email,
          m.avatar_color, m.avatar_object_key IS NOT NULL AS has_avatar, m.avatar_updated_at
        FROM members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = ? AND m.workspace_id = ? LIMIT 1`).bind(auth.memberId, auth.workspaceId).first<Record<string, unknown>>() : Promise.resolve(null),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT e.id, e.student_id, e.event_type, e.previous_starts_at, e.starts_at, e.ends_at, e.note, e.occurred_at,
        lesson.group_id AS lesson_group_id, lesson.lesson_type, student.display_name, actor.display_name AS actor_name
        FROM lesson_events e
        JOIN members student ON student.id = e.student_id
        LEFT JOIN lessons lesson ON lesson.id = e.lesson_id
        LEFT JOIN members actor ON actor.id = e.actor_member_id
        WHERE e.workspace_id = ? AND (? IS NULL OR e.student_id = ?)
        ORDER BY e.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT r.id, r.student_id, r.type, r.status, r.proposed_starts_at, r.message, r.created_at, r.resolved_at,
        student.display_name, resolver.display_name AS actor_name, l.starts_at AS lesson_starts_at
        FROM lesson_requests r
        JOIN members student ON student.id = r.student_id
        LEFT JOIN members resolver ON resolver.id = r.resolved_by_id
        LEFT JOIN lessons l ON l.id = r.lesson_id
        WHERE r.workspace_id = ? AND (? IS NULL OR r.student_id = ?)
        ORDER BY COALESCE(r.resolved_at, r.created_at) DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("historyEvents"), () => db.prepare(`SELECT b.id, b.student_id, b.kind, b.lesson_units, b.note, b.occurred_at, b.reverses_entry_id,
        EXISTS(SELECT 1 FROM balance_entries reversal WHERE reversal.reverses_entry_id = b.id) AS reversed,
        lesson.group_id AS lesson_group_id, student.display_name, actor.display_name AS actor_name
        FROM balance_entries b
        JOIN members student ON student.id = b.student_id
        LEFT JOIN lessons lesson ON lesson.id = b.lesson_id
        LEFT JOIN members actor ON actor.id = b.recorded_by_id
        WHERE b.workspace_id = ? AND (? IS NULL OR b.student_id = ?)
        ORDER BY b.occurred_at DESC LIMIT 500`).bind(auth.workspaceId, ownStudentId, ownStudentId).all()),
      loadRows(needs("availability") && availabilityAccess, () => db.prepare("SELECT id, weekday, start_minutes, end_minutes FROM availability_windows WHERE workspace_id = ? ORDER BY weekday, start_minutes").bind(auth.workspaceId).all()),
      loadRows(needs("availability") && auth.role === "student" && availabilityAccess, () => db.prepare("SELECT starts_at, ends_at FROM lessons WHERE workspace_id = ? AND status = 'scheduled' AND ends_at > ? AND starts_at < ? ORDER BY starts_at").bind(auth.workspaceId, Date.now(), availabilityHorizon).all()),
    ]);

    const seriesByStudent = new Map<string, Array<{ weekday: number; start: number }>>();
    for (const row of seriesRows.results as Array<Record<string, unknown>>) {
      const id = String(row.student_id);
      seriesByStudent.set(id, [...(seriesByStudent.get(id) ?? []), { weekday: Number(row.weekday), start: Number(row.start_minutes) }]);
    }
    const weekdays = ["", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
    const recurringSlots = (seriesRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id),
      label: `${weekdays[Number(row.weekday)]} ${minutesToTime(Number(row.start_minutes))}`,
      durationMinutes: Number(row.duration_minutes),
    }));
    const students = (studentRows.results as Array<Record<string, unknown>>).map((row) => {
      const floating = row.schedule_type === "floating";
      const series = seriesByStudent.get(String(row.id)) ?? [];
      const schedule = floating ? "Плавающее" : series.length ? series.map(({ weekday, start }) => `${weekdays[weekday]} ${minutesToTime(start)}`).join(", ") : "Постоянное расписание не задано";
      return {
        id: String(row.id), name: String(row.display_name), email: row.email ? String(row.email) : undefined, initials: initials(String(row.display_name)),
        schedule, next: row.next_lesson ? `${dateLabel.format(new Date(Number(row.next_lesson)))}, ${timeLabel.format(new Date(Number(row.next_lesson)))}` : "Не назначен",
        balance: Number(row.balance), floating, canViewAvailability: Boolean(row.can_view_availability), archived: row.status === "archived", trialEligible: Boolean(row.trial_eligible), accountStatus: Boolean(row.account_ready) ? "active" : "invited",
        ownAvatarColor: String(row.avatar_color ?? "indigo"), avatarColor: String(row.avatar_override_color ?? row.avatar_color ?? "indigo"),
        avatarUrl: row.has_avatar ? `/api/profile/avatar?memberId=${encodeURIComponent(String(row.id))}&v=${Number(row.avatar_updated_at ?? 0)}` : undefined,
      };
    });
    const rawLessonRows = lessonRows.results as Array<Record<string, unknown>>;
    const outstandingPastLessons = new Set<string>();
    const remainingDebt = new Map<string, number>();
    for (const row of [...rawLessonRows].reverse()) {
      if (row.lesson_status !== "completed" || row.lesson_type === "trial") continue;
      const studentId = String(row.student_id);
      const debt = remainingDebt.get(studentId) ?? Math.max(0, -Number(row.balance));
      if (debt > 0) {
        outstandingPastLessons.add(String(row.id));
        remainingDebt.set(studentId, debt - 1);
      }
    }
    const remainingByStudent = new Map<string, number>();
    const lessonParts: LessonPart[] = rawLessonRows.map((row) => {
      const studentId = String(row.student_id);
      const balance = Number(row.balance);
      const remaining = remainingByStudent.get(studentId) ?? Math.max(0, balance);
      const requestType = row.request_type ? String(row.request_type) : null;
      const past = row.lesson_status === "completed";
      const trial = row.lesson_type === "trial";
      const covered = trial || remaining > 0;
      if (!past && !trial && requestType !== "cancel") remainingByStudent.set(studentId, Math.max(0, remaining - 1));
      const pastUnpaid = past && outstandingPastLessons.has(String(row.id));
      const status: LessonPart["status"] = trial ? "trial" : past ? (pastUnpaid ? "debt" : "paid") : requestType ? "request" : balance < 0 ? "debt" : covered ? "paid" : "low";
      const label = trial ? (past ? "Пробное · проведено" : "Пробное · бесплатно") : past ? (pastUnpaid ? "Проведён · не оплачен" : "Проведён · оплачен") : status === "request" ? "Ожидает ответа" : balance < 0 ? `Баланс ${balance}` : covered ? "Оплачен" : "Не оплачен";
      const start = new Date(Number(row.starts_at));
      return { id: String(row.id), groupId: row.group_id ? String(row.group_id) : undefined, studentId, date: toMoscowDate(start), time: timeLabel.format(start), end: timeLabel.format(new Date(Number(row.ends_at))), name: String(row.display_name), status, label, lessonType: trial ? "trial" : "regular", trialContact: Boolean(row.is_trial_contact), past, startsAt: Number(row.starts_at), units: 1, hasFile: Boolean(row.has_file), hasNote: Boolean(row.has_note) };
    });
    const lessons = groupLessonParts(lessonParts);
    const requests = (requestRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.type);
      const sourceDate = row.starts_at ? new Date(Number(row.starts_at)) : null;
      const proposedDate = row.proposed_starts_at ? new Date(Number(row.proposed_starts_at)) : null;
      const title = kind === "cancel" ? "Отмена · требует решения" : kind === "reschedule" ? "Перенос" : "Новое занятие";
      const doubleLesson = kind === "new_lesson" && row.proposed_starts_at && row.proposed_ends_at && Number(row.proposed_ends_at) - Number(row.proposed_starts_at) === 120 * 60_000;
      const detail = kind === "reschedule" && sourceDate && proposedDate
        ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)} → ${dateLabel.format(proposedDate)}, ${timeLabel.format(proposedDate)}`
        : proposedDate ? `${dateLabel.format(proposedDate)} · ${timeLabel.format(proposedDate)}${doubleLesson ? " · двойной урок, 2 часа" : ""}` : sourceDate ? `${dateLabel.format(sourceDate)}, ${timeLabel.format(sourceDate)}` : "Время не выбрано";
      return { id: String(row.id), type: title, kind, name: String(row.display_name), detail, note: String(row.message ?? "Без комментария") };
    });
    const balanceEntries = (balanceRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), studentId: String(row.student_id), kind: String(row.kind), units: Number(row.lesson_units),
      note: String(row.note ?? (row.kind === "payment" ? "Оплата занятий" : "Урок проведён")), date: toMoscowDate(new Date(Number(row.occurred_at))), reversed: Boolean(row.reversed),
    }));
    const lessonHistory = groupDoubleLessonEvents(lessonEventRows.results as Array<Record<string, unknown>>).map((row) => {
      const eventType = String(row.event_type);
      const titles: Record<string, string> = { scheduled: "Урок назначен", rescheduled: "Урок перенесён", cancelled: "Урок отменён", completed: "Урок проведён", series_stopped: "Постоянное расписание остановлено" };
      const doubleLesson = Number(row.lesson_units) === 2;
      const current = row.starts_at ? formatHistoryLesson(Number(row.starts_at), row.ends_at ? Number(row.ends_at) : null) : "";
      const previous = row.previous_starts_at ? historyMomentLabel.format(new Date(Number(row.previous_starts_at))) : "";
      const detail = eventType === "rescheduled" && previous ? `${previous} → ${current}` : [current, row.note ? String(row.note) : ""].filter(Boolean).join(" · ");
      const title = row.lesson_type === "trial" ? `Пробное занятие ${eventType === "completed" ? "проведено" : eventType === "cancelled" ? "отменено" : eventType === "rescheduled" ? "перенесено" : "назначено"}` : titles[eventType] ?? "Изменение урока";
      return { id: `lesson:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "lesson", type: eventType, title: doubleLesson ? `Двойной ${title.toLocaleLowerCase("ru-RU")}` : title, detail, actor: row.actor_name ? String(row.actor_name) : eventType === "completed" ? "Автоматически" : undefined, occurredAt: Number(row.occurred_at) };
    });
    const requestTypeNames: Record<string, string> = { cancel: "отмену", reschedule: "перенос", new_lesson: "новый урок" };
    const requestStatusNames: Record<string, string> = { pending: "ожидает решения", approved: "подтверждён", declined: "отклонён", expired: "истёк" };
    const requestHistory = (historyRequestRows.results as Array<Record<string, unknown>>).map((row) => {
      const requestType = String(row.type);
      const status = String(row.status);
      const target = row.proposed_starts_at ?? row.lesson_starts_at;
      const detail = [target ? historyMomentLabel.format(new Date(Number(target))) : "", row.message ? String(row.message) : ""].filter(Boolean).join(" · ");
      return { id: `request:${row.id}`, studentId: String(row.student_id), studentName: String(row.display_name), category: "request", type: status, title: `Запрос на ${requestTypeNames[requestType] ?? "изменение"} ${requestStatusNames[status] ?? status}`, detail, actor: status === "pending" ? String(row.display_name) : row.actor_name ? String(row.actor_name) : undefined, occurredAt: Number(row.resolved_at ?? row.created_at) };
    });
    const balanceHistory = groupDoubleLessonCharges(historyBalanceRows.results as Array<Record<string, unknown>>).map((row) => {
      const kind = String(row.kind);
      const units = Number(row.lesson_units);
      const titles: Record<string, string> = { payment: "Оплата учтена", lesson_charge: "Списание за урок", adjustment: "Корректировка баланса", refund: "Отмена оплаты" };
      const reversed = Boolean(row.reversed);
      const title = row.double_lesson ? "Списание за двойной урок" : titles[kind] ?? "Операция баланса";
      return { id: `balance:${row.id}`, sourceId: String(row.id), studentId: String(row.student_id), studentName: String(row.display_name), category: "payment", type: kind, title: `${title}${reversed ? " · отменена" : ""}`, detail: [units > 0 ? `+${units} занятий` : `${units} занятий`, row.note ? String(row.note) : ""].filter(Boolean).join(" · "), actor: kind === "lesson_charge" ? "Автоматически" : row.actor_name ? String(row.actor_name) : undefined, units, canReverse: kind === "payment" && !reversed, occurredAt: Number(row.occurred_at) };
    });
    const historyEvents = [...lessonHistory, ...requestHistory, ...balanceHistory].sort((a, b) => b.occurredAt - a.occurredAt).slice(0, 500);
    const availabilityWindows = (availabilityRows.results as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), weekday: Number(row.weekday), startMinutes: Number(row.start_minutes), endMinutes: Number(row.end_minutes) }));
    const availableSlots = auth.role === "student" && availabilityAccess
      ? buildAvailableSlots(availabilityWindows, (availabilityBusyRows.results as Array<Record<string, unknown>>).map((row) => ({ start: Number(row.starts_at), end: Number(row.ends_at) })), Date.now())
      : [];
    const notifications = (notificationRows.results as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), type: String(row.type), title: String(row.title), body: String(row.body), read: Boolean(row.read_at), createdAt: Number(row.created_at),
      studentName: row.student_name ? String(row.student_name) : undefined,
      requestType: row.request_type ? String(row.request_type) : undefined,
      requestStatus: row.request_status ? String(row.request_status) : undefined,
      requestMessage: row.request_message ? String(row.request_message) : undefined,
      lessonStartsAt: row.lesson_starts_at ? Number(row.lesson_starts_at) : undefined,
      lessonEndsAt: row.lesson_ends_at ? Number(row.lesson_ends_at) : undefined,
      proposedStartsAt: row.proposed_starts_at ? Number(row.proposed_starts_at) : undefined,
      proposedEndsAt: row.proposed_ends_at ? Number(row.proposed_ends_at) : undefined,
      lessonUnits: row.lesson_units === null || row.lesson_units === undefined ? undefined : Number(row.lesson_units),
    }));
    const payload: Record<string, unknown> = { syncCursor };
    if (needs("students")) payload.students = students;
    if (needs("lessons")) { payload.lessons = lessons; payload.recurringSlots = recurringSlots; }
    if (needs("requests")) payload.requests = requests;
    if (needs("balanceEntries")) payload.balanceEntries = balanceEntries;
    if (needs("historyEvents")) payload.historyEvents = historyEvents;
    if (needs("notifications")) payload.notifications = notifications;
    if (needs("availability")) {
      if (auth.role === "student") payload.availableSlots = availableSlots;
      else payload.availabilityWindows = availabilityWindows;
    }
    if (needs("profile")) {
      payload.currentStudentId = ownStudentId;
      payload.teacherName = teacherRow?.display_name ?? "Преподаватель";
      payload.teacherTitle = teacherRow?.professional_title ?? "Репетитор";
      payload.profile = viewerRow ? {
        name: viewerRow.display_name, professionalTitle: viewerRow.professional_title, email: viewerRow.email,
        avatarColor: viewerRow.avatar_color ?? "indigo",
        avatarUrl: viewerRow.has_avatar ? `/api/profile/avatar?memberId=${encodeURIComponent(auth.memberId)}&v=${Number(viewerRow.avatar_updated_at ?? 0)}` : undefined,
      } : undefined;
    }
    return Response.json(payload);
  } catch (error) {
    console.error("Failed to load app data", error);
    return Response.json({ error: "Не удалось загрузить данные" }, { status: 500 });
  }
}

