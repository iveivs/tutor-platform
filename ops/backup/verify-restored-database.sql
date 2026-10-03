\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.workspaces') IS NULL OR to_regclass('public.users') IS NULL OR to_regclass('public.lessons') IS NULL THEN
    RAISE EXCEPTION 'required Tutor Platform tables are missing';
  END IF;
  IF EXISTS (SELECT 1 FROM members m LEFT JOIN workspaces w ON w.id = m.workspace_id WHERE w.id IS NULL) THEN
    RAISE EXCEPTION 'orphan member workspace reference';
  END IF;
  IF EXISTS (SELECT 1 FROM lessons l LEFT JOIN members m ON m.id = l.student_id WHERE m.id IS NULL) THEN
    RAISE EXCEPTION 'orphan lesson student reference';
  END IF;
  IF EXISTS (SELECT 1 FROM balance_entries WHERE kind = 'lesson_charge' GROUP BY lesson_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate lesson charge';
  END IF;
  IF EXISTS (SELECT 1 FROM balance_entries WHERE reverses_entry_id IS NOT NULL GROUP BY reverses_entry_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'duplicate payment reversal';
  END IF;
  IF EXISTS (SELECT 1 FROM auth_sessions WHERE length(token_hash) <> 64) THEN
    RAISE EXCEPTION 'invalid session token hash';
  END IF;
END $$;

SELECT json_build_object(
  'workspaces', (SELECT count(*) FROM workspaces),
  'users', (SELECT count(*) FROM users),
  'members', (SELECT count(*) FROM members),
  'lessons', (SELECT count(*) FROM lessons),
  'balance_entries', (SELECT count(*) FROM balance_entries)
) AS restored_counts;
