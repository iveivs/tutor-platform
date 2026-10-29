import { russianPlural } from "@/lib/russian-plural";
import { daysLeft, type WorkspaceAccessMode } from "@/lib/workspace-access";

const longDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Europe/Moscow" });
const longDateYear = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Moscow" });

/** "10 ноября", with the year only when it is not the current one. */
export function accessDate(value: number) {
  const sameYear = new Date(value).getFullYear() === new Date().getFullYear();
  return (sameYear ? longDate : longDateYear).format(new Date(value));
}

export function paidOnDate(isoDate: string) {
  return accessDate(Date.parse(`${isoDate}T12:00:00Z`));
}

export function rubles(cents: number) {
  return `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(cents / 100)} ₽`;
}

export const monthsLabel = (months: number) => russianPlural(months, "месяц", "месяца", "месяцев");
export const daysLabel = (days: number) => russianPlural(days, "день", "дня", "дней");

/** Days left of the access, or null without an end date. 0 = the last day is today. */
export function accessDaysLeft(mode: WorkspaceAccessMode, expiresAt: number | null | undefined) {
  if (mode === "read_only" || !expiresAt) return null;
  return daysLeft(expiresAt);
}
