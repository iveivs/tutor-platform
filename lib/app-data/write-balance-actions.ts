import { MOSCOW_OFFSET, invalid, toMoscowDate } from "@/lib/app-data/route-utils";

import type { WriteActionContext } from "@/lib/app-data/write-action-types";

export async function executeBalanceAction({ db, body, auth, id }: WriteActionContext): Promise<Response | void> {
  if (body.action === "addPayment") {
    if (!body.studentId || !Number.isInteger(body.count) || body.count <= 0 || body.count > 100 || (body.paymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(body.paymentDate))) return invalid();
    const currentDate = toMoscowDate(new Date());
    if (body.paymentDate && body.paymentDate > currentDate) return Response.json({ error: "Дата оплаты не может быть в будущем" }, { status: 400 });
    const occurredAt = !body.paymentDate || body.paymentDate === currentDate ? Date.now() : new Date(`${body.paymentDate}T12:00:00${MOSCOW_OFFSET}`).getTime();
    if (!Number.isFinite(occurredAt)) return invalid();
    const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND is_trial_contact = 0 AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    await db.batch([
      db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
        VALUES (?, ?, ?, 'payment', ?, 'Оплата занятий', ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.count, occurredAt, auth.memberId),
      db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'payment_recorded', 'Оплата учтена', ?)")
        .bind(crypto.randomUUID(), body.studentId, body.studentId, id, `Баланс пополнен на ${body.count} занятий.`),
    ]);
  } else if (body.action === "adjustBalance") {
    const student = await db.prepare("SELECT id FROM members WHERE id = ? AND workspace_id = ? AND role = 'student' AND status != 'archived'").bind(body.studentId, auth.workspaceId).first();
    if (!student) return Response.json({ error: "Ученик не найден" }, { status: 404 });
    const occurredAt = Date.now();
    await db.batch([
      db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, note, occurred_at, recorded_by_id)
        VALUES (?, ?, ?, 'adjustment', ?, ?, ?, ?)`).bind(id, auth.workspaceId, body.studentId, body.units, body.note.trim(), occurredAt, auth.memberId),
      db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'balance_adjusted', 'Баланс скорректирован', ?)")
        .bind(crypto.randomUUID(), body.studentId, body.studentId, id, `Изменение баланса: ${body.units > 0 ? "+" : ""}${body.units} занятий. ${body.note.trim()}`),
    ]);
  } else if (body.action === "reversePayment") {
    const payment = await db.prepare(`SELECT b.id, b.student_id, b.lesson_units
      FROM balance_entries b
      JOIN members student ON student.id = b.student_id
      WHERE b.id = ? AND b.workspace_id = ? AND b.kind = 'payment' AND b.lesson_units > 0
        AND student.workspace_id = ? AND student.role = 'student' LIMIT 1`)
      .bind(body.paymentId, auth.workspaceId, auth.workspaceId)
      .first<{ id: string; student_id: string; lesson_units: number }>();
    if (!payment) return Response.json({ error: "Оплата не найдена" }, { status: 404 });
    const existingReversal = await db.prepare("SELECT id FROM balance_entries WHERE reverses_entry_id = ? LIMIT 1").bind(payment.id).first();
    if (existingReversal) return Response.json({ error: "Эта оплата уже отменена" }, { status: 409 });
    await db.batch([
      db.prepare(`INSERT INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, reverses_entry_id, note, occurred_at, recorded_by_id)
        VALUES (?, ?, ?, 'refund', ?, ?, 'Отмена ошибочной оплаты', ?, ?)`)
        .bind(id, auth.workspaceId, payment.student_id, -payment.lesson_units, payment.id, Date.now(), auth.memberId),
      db.prepare("INSERT INTO notifications (id, member_id, student_id, balance_entry_id, type, title, body) VALUES (?, ?, ?, ?, 'payment_reversed', 'Оплата отменена', ?)")
        .bind(crypto.randomUUID(), payment.student_id, payment.student_id, id, `Ошибочная оплата на ${payment.lesson_units} занятий отменена.`),
    ]);
  }
}
