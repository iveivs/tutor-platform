import { russianPlural } from "@/lib/russian-plural";
import { accessModeAt, daysLeft, moscowDate } from "@/lib/workspace-access";

export type AdminWorkspace = {
  id: string; name: string; ownerName: string; ownerTitle: string; ownerEmail: string; timezone: string; subscriptionStatus: string;
  accessStatus: "active" | "blocked"; accessGrant: "legacy" | "complimentary" | "trial" | "paid" | "unlimited";
  accessExpiresAt: number | null; adminNote: string; studentCount: number; groupCount: number; storageBytes: number;
  createdAt: number; lastActivityAt: number | null;
};
export type AdminPayment = { id: string; workspaceId: string; amountCents: number; months: number; paidOn: string; method: "transfer" | "cash" | "other"; receiptRef: string; accessUntil: number; status: "paid" | "refunded"; createdAt: number };
export type AdminAuditEvent = { id: string; workspaceId: string; workspaceName: string; actorName: string; action: string; previousValue: string | null; newValue: string | null; createdAt: number };
export type TeacherInvitation = { id: string; name: string; email: string; professionalTitle: string; accessGrant: string; expiresAt: number; createdAt: number };

export type AccessState = "blocked" | "read_only" | "ending" | "trial" | "paid" | "free" | "unlimited";

// Ending = the last week of a limited access; it is shown before the access type.
export function accessState(workspace: AdminWorkspace, now = Date.now()): AccessState {
  if (workspace.accessStatus === "blocked") return "blocked";
  if (workspace.accessGrant === "unlimited") return "unlimited";
  if (workspace.accessExpiresAt && accessModeAt(workspace.accessExpiresAt, now) === "read_only") return "read_only";
  if (workspace.accessExpiresAt && daysLeft(workspace.accessExpiresAt, now) <= 7) return "ending";
  if (workspace.accessGrant === "trial") return "trial";
  if (workspace.accessGrant === "paid") return "paid";
  return "free";
}

export const grantLabel: Record<AdminWorkspace["accessGrant"], string> = { unlimited: "Бессрочный", trial: "Пробный период", paid: "Платная подписка", complimentary: "Бесплатно", legacy: "Бесплатно (ранний)" };
export const methodLabel: Record<AdminPayment["method"], string> = { transfer: "Перевод", cash: "Наличные", other: "Другое" };

export const stateChip: Record<AccessState, { label: string; className: string }> = {
  blocked: { label: "Заблокирован", className: "bg-surface-muted text-ink-strong" },
  read_only: { label: "Только просмотр", className: "bg-danger-soft text-danger-ink" },
  ending: { label: "Заканчивается", className: "bg-warning-soft text-warning-ink" },
  trial: { label: "Пробный", className: "bg-brand-soft text-brand-ink" },
  paid: { label: "Платная", className: "bg-success-soft text-success-ink" },
  free: { label: "Бесплатно", className: "bg-surface-subtle text-ink-muted ring-1 ring-line" },
  unlimited: { label: "Бессрочный", className: "bg-brand-soft-strong text-brand-ink-strong" },
};

export const daysLabel = (days: number) => russianPlural(days, "день", "дня", "дней");

/** Chip text with the days left, e.g. "Пробный · 21 день". */
export function chipText(workspace: AdminWorkspace, state: AccessState) {
  const base = state === "ending" ? grantLabel[workspace.accessGrant].replace("Платная подписка", "Платная") : stateChip[state].label;
  if ((state === "ending" || state === "trial" || state === "paid") && workspace.accessExpiresAt) return `${base} · ${daysLabel(Math.max(0, daysLeft(workspace.accessExpiresAt)))}`;
  if (state === "free" && !workspace.accessExpiresAt) return "Бесплатно навсегда";
  return base;
}

const shortDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" });
const dateTime = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
export const formatDate = (value: number | null) => value ? shortDate.format(new Date(value)) : "—";
export const formatDateTime = (value: number | null) => value ? dateTime.format(new Date(value)) : "Ещё не входили";
export const todayIso = () => moscowDate(Date.now());
export const isoOf = (value: number) => moscowDate(value);

export function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1).replace(".", ",")} ГБ`;
}

export const rubles = (cents: number) => `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(cents / 100)} ₽`;

/** One line of the admin journal in plain words. */
export function auditText(event: AdminAuditEvent) {
  const until = (value: string | null) => {
    const iso = value?.split("|")[1];
    return iso ? `до ${formatDate(Date.parse(iso))}` : "без срока";
  };
  const grant = (value: string | null) => grantLabel[(value?.split("|")[0] ?? "legacy") as AdminWorkspace["accessGrant"]] ?? value ?? "";
  if (event.action === "workspace_blocked") return "Доступ приостановлен";
  if (event.action === "workspace_unblocked") return "Доступ восстановлен";
  if (event.action === "access_terms_changed") return `Доступ: ${grant(event.newValue)}, ${until(event.newValue)}`;
  if (event.action === "subscription_payment_added") {
    const [amount, months, iso] = (event.newValue ?? "").split("|");
    return `Платёж ${rubles(Number(amount))} за ${russianPlural(Number(months), "месяц", "месяца", "месяцев")}, доступ до ${formatDate(Date.parse(iso))}`;
  }
  if (event.action === "subscription_payment_refunded") return `Возврат платежа ${rubles(Number(event.newValue))}`;
  return event.action;
}
