export const incrementalDataSections = ["students", "lessons", "requests", "balanceEntries", "notifications", "historyEvents", "profile"] as const;

export type IncrementalDataSection = typeof incrementalDataSections[number];

export function collectChangedSections(rows: Array<{ sections: string; id: number }>, cursor: number) {
  const sections = new Set<IncrementalDataSection>();
  let nextCursor = cursor;
  for (const row of rows) {
    nextCursor = Math.max(nextCursor, Number(row.id));
    for (const section of row.sections.split(",")) {
      if (incrementalDataSections.includes(section as IncrementalDataSection)) sections.add(section as IncrementalDataSection);
    }
  }
  return { sections, cursor: nextCursor };
}

export function syncDelayForMoscowHour(hour: number) {
  return hour >= 7 || hour < 1 ? 60_000 : 600_000;
}
