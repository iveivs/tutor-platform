INSERT OR IGNORE INTO workspaces (id, name, timezone) VALUES
  ('1', 'Кабинет Анны Петровой', 'Europe/Moscow');

INSERT OR IGNORE INTO users (id, auth_subject, email, full_name) VALUES
  ('1', 'local_teacher', 'teacher@example.com', 'Анна Петрова');

INSERT OR IGNORE INTO members (id, workspace_id, user_id, role, status, display_name, email, schedule_type) VALUES
  ('1', '1', '1', 'owner', 'active', 'Анна Петрова', 'teacher@example.com', 'fixed'),
  ('101', '1', NULL, 'student', 'invited', 'Иван Сидоров', 'ivan@example.com', 'floating'),
  ('102', '1', NULL, 'student', 'invited', 'Мария Иванова', 'maria@example.com', 'fixed'),
  ('103', '1', NULL, 'student', 'invited', 'Пётр Васильев', 'petr@example.com', 'floating'),
  ('104', '1', NULL, 'student', 'invited', 'Анна Смирнова', 'smirnova@example.com', 'fixed');

INSERT OR IGNORE INTO lesson_series (id, workspace_id, student_id, weekday, start_minutes, active_from) VALUES
  ('201', '1', '102', 1, 810, '2026-09-01'),
  ('202', '1', '102', 4, 810, '2026-09-01'),
  ('203', '1', '104', 2, 1140, '2026-09-01');

INSERT OR IGNORE INTO lessons (id, workspace_id, student_id, series_id, starts_at, ends_at, status, charge_status, created_by_id) VALUES
  ('301', '1', '101', NULL, unixepoch('2026-09-16 07:00:00') * 1000, unixepoch('2026-09-16 08:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('302', '1', '102', '202', unixepoch('2026-09-16 10:30:00') * 1000, unixepoch('2026-09-16 11:30:00') * 1000, 'scheduled', 'pending', '1'),
  ('303', '1', '103', NULL, unixepoch('2026-09-16 14:00:00') * 1000, unixepoch('2026-09-16 15:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('304', '1', '104', '203', unixepoch('2026-09-16 16:00:00') * 1000, unixepoch('2026-09-16 17:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('305', '1', '101', NULL, unixepoch('2026-09-18 14:00:00') * 1000, unixepoch('2026-09-18 15:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('306', '1', '101', NULL, unixepoch('2026-09-21 14:00:00') * 1000, unixepoch('2026-09-21 15:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('307', '1', '104', '203', unixepoch('2026-09-22 16:00:00') * 1000, unixepoch('2026-09-22 17:00:00') * 1000, 'scheduled', 'pending', '1'),
  ('308', '1', '103', NULL, unixepoch('2026-09-23 15:00:00') * 1000, unixepoch('2026-09-23 16:00:00') * 1000, 'scheduled', 'pending', '1');

INSERT OR IGNORE INTO balance_entries (id, workspace_id, student_id, kind, lesson_units, amount_cents, note, recorded_by_id) VALUES
  ('401', '1', '101', 'payment', 8, 1600000, 'Абонемент на 8 занятий', '1'),
  ('402', '1', '101', 'adjustment', -10, NULL, 'Перенос начального баланса', '1'),
  ('403', '1', '102', 'payment', 1, 200000, 'Разовая оплата', '1'),
  ('404', '1', '103', 'payment', 4, 800000, 'Абонемент на 4 занятия', '1'),
  ('405', '1', '104', 'payment', 8, 1600000, 'Абонемент на 8 занятий', '1');

INSERT OR IGNORE INTO lesson_requests (id, workspace_id, student_id, lesson_id, type, status, proposed_starts_at, proposed_ends_at, message, cancellation_deadline_at) VALUES
  ('501', '1', '101', '305', 'cancel', 'pending', NULL, NULL, 'Не смогу прийти', unixepoch('2026-09-17 20:59:59') * 1000),
  ('502', '1', '102', '302', 'reschedule', 'pending', unixepoch('2026-09-21 12:00:00') * 1000, unixepoch('2026-09-21 13:00:00') * 1000, 'Можно перенести?', NULL),
  ('503', '1', '103', NULL, 'new_lesson', 'pending', unixepoch('2026-09-23 15:00:00') * 1000, unixepoch('2026-09-23 16:00:00') * 1000, 'Подойдёт также 24 сентября в 17:00', NULL);
