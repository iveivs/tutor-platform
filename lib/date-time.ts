const MOSCOW_TIME_ZONE = "Europe/Moscow";

export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: MOSCOW_TIME_ZONE }).format(new Date());
export const moscowDate = (value: number) => new Intl.DateTimeFormat("en-CA", { timeZone: MOSCOW_TIME_ZONE }).format(new Date(value));
export const moscowTime = (value: number) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: MOSCOW_TIME_ZONE }).format(new Date(value));
export const dateAtNoon = (value: string) => new Date(`${value}T12:00:00Z`);
export const toIsoDate = (value: Date) => value.toISOString().slice(0, 10);
export const shiftDate = (value: string, days: number) => { const date = dateAtNoon(value); date.setUTCDate(date.getUTCDate() + days); return toIsoDate(date); };
export const shiftMonth = (value: string, months: number) => { const date = dateAtNoon(value); const day = date.getUTCDate(); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months); date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate())); return toIsoDate(date); };
export const dateTitle = (value: string, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) => new Intl.DateTimeFormat("ru-RU", { ...options, timeZone: "UTC" }).format(dateAtNoon(value));
