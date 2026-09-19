export async function settlePastLessons(db: D1Database, workspaceId: string, now = Date.now()) {
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO balance_entries (id, workspace_id, student_id, lesson_id, kind, lesson_units, note, occurred_at, recorded_by_id)
      SELECT lower(hex(randomblob(16))), l.workspace_id, l.student_id, l.id, 'lesson_charge', -1, 'Урок проведён', l.ends_at, l.created_by_id
      FROM lessons l
      WHERE l.workspace_id = ? AND l.status = 'scheduled' AND l.charge_status = 'pending' AND l.ends_at <= ?
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r WHERE r.lesson_id = l.id AND r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at)`)
      .bind(workspaceId, now),
    db.prepare(`UPDATE lessons SET status = 'completed', charge_status = 'charged', completed_at = ends_at, updated_at = ?
      WHERE workspace_id = ? AND status = 'scheduled' AND charge_status = 'pending' AND ends_at <= ?
        AND NOT EXISTS (SELECT 1 FROM lesson_requests r WHERE r.lesson_id = lessons.id AND r.type = 'cancel' AND r.status = 'pending' AND r.created_at <= r.cancellation_deadline_at)`)
      .bind(now, workspaceId, now),
    db.prepare(`INSERT OR IGNORE INTO notifications (id, member_id, type, title, body)
      SELECT 'debt-' || l.id, l.student_id, 'negative_balance', 'Отрицательный баланс', 'После урока баланс стал отрицательным. Пожалуйста, свяжитесь с преподавателем.'
      FROM lessons l WHERE l.workspace_id = ? AND l.charge_status = 'charged' AND l.updated_at = ?
        AND (SELECT COALESCE(SUM(b.lesson_units), 0) FROM balance_entries b WHERE b.student_id = l.student_id) < 0`)
      .bind(workspaceId, now),
  ]);
}

export async function settleAllWorkspaces(db: D1Database, now = Date.now()) {
  const rows = await db.prepare("SELECT id FROM workspaces").all<{ id: string }>();
  for (const workspace of rows.results) await settlePastLessons(db, String(workspace.id), now);
}
