// Paid access of a teacher's workspace. A workspace whose access_expires_at has passed stays
// readable but becomes read-only: data is never deleted for non-payment. A null end date
// means access without a time limit (free workspaces, the platform admin's own one).

export type WorkspaceAccessMode = "full" | "read_only";
// unlimited = «Бессрочный»: given by the admin by hand (owner, testers), never sold, never ends.
export type AccessGrant = "legacy" | "complimentary" | "trial" | "paid" | "unlimited";

export const TRIAL_DAYS = 30;
// The teacher sees an "access ends soon" banner this many days ahead (reminders: scripts/access-reminders.mjs).
export const ACCESS_WARNING_DAYS = 7;
export const READ_ONLY_MESSAGE = "Кабинет в режиме просмотра: срок доступа закончился";

const DAY_MS = 24 * 60 * 60 * 1000;
// Moscow has no daylight saving time, so its offset is fixed. Every workspace uses Europe/Moscow.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

function toMs(value: Date | number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function accessModeAt(expiresAt: Date | number | string | null | undefined, now = Date.now()): WorkspaceAccessMode {
  const ms = toMs(expiresAt);
  return ms !== null && ms <= now ? "read_only" : "full";
}

/** Last millisecond of the Moscow calendar day that contains the given moment. */
export function endOfMoscowDay(value: Date | number) {
  const ms = toMs(value) ?? Date.now();
  const moscow = new Date(ms + MOSCOW_OFFSET_MS);
  return new Date(Date.UTC(moscow.getUTCFullYear(), moscow.getUTCMonth(), moscow.getUTCDate() + 1) - MOSCOW_OFFSET_MS - 1);
}

/** End of the given YYYY-MM-DD day in Moscow, used for "access until" dates set by the admin. */
export function endOfMoscowDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1) - MOSCOW_OFFSET_MS - 1);
}

/** The Moscow calendar date (YYYY-MM-DD) of a moment. */
export function moscowDate(value: Date | number) {
  return new Date((toMs(value) ?? Date.now()) + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);
}

function addCalendarMonths(ms: number, months: number) {
  const moscow = new Date(ms + MOSCOW_OFFSET_MS);
  const year = moscow.getUTCFullYear();
  const month = moscow.getUTCMonth() + months;
  // 31 January + 1 month is the last day of February, not 3 March.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(moscow.getUTCDate(), lastDay);
  return Date.UTC(year, month, day, moscow.getUTCHours(), moscow.getUTCMinutes(), moscow.getUTCSeconds(), moscow.getUTCMilliseconds()) - MOSCOW_OFFSET_MS;
}

/**
 * A payment for N months continues the paid period if it has not ended yet, otherwise it
 * starts today. Access always lasts until the end of the last day.
 */
export function extendAccess(currentExpiresAt: Date | number | string | null | undefined, months: number, now = Date.now()) {
  const current = toMs(currentExpiresAt);
  const from = current !== null && current > now ? current : now;
  return { from: new Date(from), until: endOfMoscowDay(addCalendarMonths(from, months)) };
}

export function trialEndsAt(now = Date.now()) {
  return endOfMoscowDay(now + TRIAL_DAYS * DAY_MS);
}

/** Whole days left until the end, counted by Moscow calendar dates (today's end = 0). */
export function daysLeft(expiresAt: Date | number | string, now = Date.now()) {
  const end = Date.parse(moscowDate(toMs(expiresAt) ?? now));
  const today = Date.parse(moscowDate(now));
  return Math.round((end - today) / DAY_MS);
}

export function readOnlyResponse() {
  return Response.json({ error: READ_ONLY_MESSAGE, code: "workspace_read_only" }, { status: 403 });
}

/** Rejects a changing request from a read-only workspace; reads always pass. */
export function rejectReadOnlyWrite(request: Request, auth: { accessMode?: WorkspaceAccessMode }) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  return auth.accessMode === "read_only" ? readOnlyResponse() : null;
}
