type HistoryRow = Record<string, unknown>;

function minNullable(values: unknown[]) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length ? Math.min(...numbers) : null;
}

function maxNullable(values: unknown[]) {
  const numbers = values.filter((value): value is number => typeof value === "number");
  return numbers.length ? Math.max(...numbers) : null;
}

export function groupDoubleLessonEvents(rows: HistoryRow[]) {
  const grouped = new Map<string, HistoryRow[]>();

  for (const row of rows) {
    const groupId = row.lesson_group_id ? String(row.lesson_group_id) : null;
    if (!groupId) {
      grouped.set(`event:${String(row.id)}`, [row]);
      continue;
    }
    const eventType = String(row.event_type);
    const action = eventType === "rescheduled" ? `:${String(row.occurred_at)}` : "";
    const key = `group:${groupId}:${eventType}${action}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.values()].map((parts) => {
    if (parts.length < 2) return parts[0];
    const first = parts[0];
    return {
      ...first,
      id: `double:${String(first.lesson_group_id)}:${String(first.event_type)}:${String(first.occurred_at)}`,
      previous_starts_at: minNullable(parts.map((part) => part.previous_starts_at)),
      starts_at: minNullable(parts.map((part) => part.starts_at)),
      ends_at: maxNullable(parts.map((part) => part.ends_at)),
      occurred_at: maxNullable(parts.map((part) => part.occurred_at)),
      note: "2 занятия",
      lesson_units: parts.length,
    };
  });
}

export function groupDoubleLessonCharges(rows: HistoryRow[]) {
  const grouped = new Map<string, HistoryRow[]>();

  for (const row of rows) {
    const groupId = row.lesson_group_id ? String(row.lesson_group_id) : null;
    if (!groupId || row.kind !== "lesson_charge") {
      grouped.set(`balance:${String(row.id)}`, [row]);
      continue;
    }
    const key = `charge:${groupId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return [...grouped.values()].map((parts) => {
    if (parts.length < 2) return parts[0];
    const first = parts[0];
    return {
      ...first,
      id: `double:${String(first.lesson_group_id)}:charge`,
      lesson_units: parts.reduce((sum, part) => sum + Number(part.lesson_units), 0),
      occurred_at: maxNullable(parts.map((part) => part.occurred_at)),
      note: "Двойной урок",
      double_lesson: true,
    };
  });
}
