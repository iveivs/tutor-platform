const HOUR_MS = 60 * 60_000;
const MOSCOW_OFFSET = "+03:00";

export type AvailabilityWindow = { id?: string; weekday: number; startMinutes: number; endMinutes: number };
export type BusyInterval = { start: number; end: number };
export type AvailableSlot = { startsAt: number; endsAt: number; maxUnits: 1 | 2 };

export function timeToMinutes(value: string) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function normalizeAvailabilityWindow(weekday: number, start: string, end: string): AvailabilityWindow | null {
  const startMinutes = timeToMinutes(start);
  const rawEndMinutes = timeToMinutes(end);
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7 || startMinutes === null || rawEndMinutes === null || startMinutes === rawEndMinutes) return null;
  return { weekday, startMinutes, endMinutes: rawEndMinutes <= startMinutes ? rawEndMinutes + 24 * 60 : rawEndMinutes };
}

export function buildAvailableSlots(windows: AvailabilityWindow[], busy: BusyInterval[], now: number, days = 14) {
  const today = moscowDate(now);
  const slots = new Map<number, AvailableSlot>();

  for (let offset = 0; offset < days; offset += 1) {
    const date = shiftIsoDate(today, offset);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
    const dayStart = new Date(`${date}T00:00:00${MOSCOW_OFFSET}`).getTime();
    for (const window of windows.filter((item) => item.weekday === weekday)) {
      const windowStart = dayStart + window.startMinutes * 60_000;
      const windowEnd = dayStart + window.endMinutes * 60_000;
      for (let startsAt = windowStart; startsAt + HOUR_MS <= windowEnd; startsAt += HOUR_MS) {
        if (startsAt <= now || overlaps(busy, startsAt, startsAt + HOUR_MS)) continue;
        const doubleAvailable = startsAt + 2 * HOUR_MS <= windowEnd && !overlaps(busy, startsAt, startsAt + 2 * HOUR_MS);
        const existing = slots.get(startsAt);
        slots.set(startsAt, { startsAt, endsAt: startsAt + HOUR_MS, maxUnits: existing?.maxUnits === 2 || doubleAvailable ? 2 : 1 });
      }
    }
  }

  return [...slots.values()].sort((a, b) => a.startsAt - b.startsAt).slice(0, 120);
}

function overlaps(busy: BusyInterval[], start: number, end: number) {
  return busy.some((item) => item.start < end && item.end > start);
}

function moscowDate(value: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/Moscow" }).formatToParts(new Date(value));
  const record = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${record.year}-${record.month}-${record.day}`;
}

function shiftIsoDate(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function minutesToInputTime(minutes: number) {
  const normalized = minutes % (24 * 60);
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}
