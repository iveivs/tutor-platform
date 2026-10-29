"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ACCESS_WARNING_DAYS } from "@/lib/workspace-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-client";
import { accessDate, accessDaysLeft, daysLabel } from "./subscription-format";

const DISMISS_KEY = "tutor-platform-access-banner";

function readDismissed() {
  try { return window.localStorage.getItem(DISMISS_KEY); } catch { return null; }
}

// Teacher-wide banner: "access ends in N days" during the last week, and read-only mode once it ended.
// «Позже» hides the warning until the next reminder day (7, 3, 1); the read-only banner always stays.
export function AccessBanner({ onRenew }: { onRenew: () => void }) {
  const access = useWorkspaceAccess();
  const [dismissed, setDismissed] = useState<string | null>(() => typeof window === "undefined" ? null : readDismissed());
  if (!access?.accessGrant || !access.accessExpiresAt) return null;
  const readOnly = access.accessMode === "read_only";
  const left = accessDaysLeft(access.accessMode, access.accessExpiresAt);
  if (!readOnly && (left === null || left > ACCESS_WARNING_DAYS)) return null;
  const stage = readOnly ? 0 : left! <= 1 ? 1 : left! <= 3 ? 3 : 7;
  const dismissKey = `${access.accessExpiresAt}:${stage}`;
  if (!readOnly && dismissed === dismissKey) return null;
  const end = accessDate(access.accessExpiresAt);
  const title = readOnly ? "Кабинет только для просмотра" : left === 0 ? "Доступ заканчивается сегодня" : `Доступ закончится через ${daysLabel(left!)}`;
  const text = readOnly
    ? `Доступ закончился ${end}. Все данные на месте, но добавлять и менять уроки, оплаты и учеников нельзя, напоминания не приходят.`
    : `Оплачено до ${end} включительно. После этого кабинет перейдёт в режим просмотра, данные сохранятся.`;
  const dismiss = () => {
    setDismissed(dismissKey);
    try { window.localStorage.setItem(DISMISS_KEY, dismissKey); } catch { /* The banner just shows again next time. */ }
  };

  return <div role="status" className={`mx-4 mt-4 flex flex-col gap-2.5 rounded-2xl p-3.5 lg:mx-8 ${readOnly ? "bg-danger-soft text-danger-ink" : "bg-warning-soft text-warning-ink"}`}>
    <div className="flex items-start gap-2.5">
      <Clock aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-0.5"><strong className="text-[15px]">{title}</strong><span className="text-[13px] leading-snug">{text}</span></div>
    </div>
    <div className="flex flex-wrap gap-2 pl-7">
      <Button type="button" size="sm" className="h-9 rounded-xl bg-brand-solid px-4 text-white hover:bg-brand-solid-hover" onClick={onRenew}>Продлить</Button>
      {!readOnly && <Button type="button" size="sm" variant="ghost" className="h-9 rounded-xl text-current hover:bg-transparent hover:underline" onClick={dismiss}>Позже</Button>}
    </div>
  </div>;
}
