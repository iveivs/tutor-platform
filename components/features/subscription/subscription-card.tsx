"use client";

import { Check, Eye, Mail, Send, UsersRound } from "lucide-react";
import type { ReactNode } from "react";
import { SettingsGroup } from "@/components/features/settings/settings-group";
import { Button } from "@/components/ui/button";
import { CONTACT_EMAIL, CONTACT_TELEGRAM_URL } from "@/lib/contacts";
import { TRIAL_DAYS } from "@/lib/workspace-access";
import { useWorkspaceAccess } from "@/lib/workspace-access-client";
import { accessDate, accessDaysLeft, daysLabel, monthsLabel, paidOnDate, rubles } from "./subscription-format";

const methodLabel = { transfer: "перевод", cash: "наличные", other: "другое" } as const;

function Consequence({ icon, tone, title, text }: { icon: ReactNode; tone: string; title: string; text: string }) {
  return <div className="flex gap-3 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
    <span aria-hidden className={`grid size-8 shrink-0 place-items-center rounded-[10px] ${tone}`}>{icon}</span>
    <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[15px] font-semibold">{title}</span><span className="text-[13px] text-ink-muted">{text}</span></span>
  </div>;
}

// Settings › «Подписка»: access type and end date, how to renew, what read-only mode means, payments.
export function SubscriptionCard() {
  const access = useWorkspaceAccess();
  if (!access?.accessGrant) return null;
  const { accessMode, accessGrant, accessExpiresAt, priceCents, payments = [] } = access;
  const readOnly = accessMode === "read_only";
  const left = accessDaysLeft(accessMode, accessExpiresAt);
  const limited = Boolean(accessExpiresAt);
  const chip = readOnly ? "Только просмотр" : accessGrant === "unlimited" ? "Бессрочный тариф" : accessGrant === "trial" ? "Пробный период" : accessGrant === "paid" ? "Платная подписка" : "Бесплатный доступ";
  const headline = readOnly ? "Доступ закончился" : left === null ? "Без ограничения по сроку" : left === 0 ? "Последний день" : `Осталось ${daysLabel(left)}`;
  const detail = readOnly && accessExpiresAt ? `Кабинет в режиме просмотра с ${accessDate(accessExpiresAt + 1)}` : accessExpiresAt ? `Полный доступ до ${accessDate(accessExpiresAt)} включительно` : "Все функции доступны";
  const trialUsed = accessGrant === "trial" && left !== null ? Math.min(TRIAL_DAYS, Math.max(0, TRIAL_DAYS - left)) : null;

  return <SettingsGroup title="Подписка">
    <div className="flex flex-col gap-3 bg-hero-start p-4 text-white">
      <span className={`self-start rounded-full px-2.5 py-1 text-xs font-bold ${readOnly ? "bg-danger-soft text-danger-ink" : "bg-white/15 text-hero-muted"}`}>{chip}</span>
      <span className="flex flex-col gap-0.5"><strong className="text-2xl font-extrabold">{headline}</strong><span className="text-sm text-hero-muted">{detail}</span></span>
      {trialUsed !== null && <>
        <span className="h-2 overflow-hidden rounded-full bg-white/15"><span className="block h-2 rounded-full bg-coral" style={{ width: `${Math.round(trialUsed / TRIAL_DAYS * 100)}%` }} /></span>
        <span className="text-xs text-hero-muted">{`${trialUsed} из ${TRIAL_DAYS} дней прошло`}</span>
      </>}
    </div>

    {limited && <div className="flex flex-col gap-3 border-t border-line p-4">
      {priceCents ? <span className="flex items-baseline justify-between gap-3"><strong className="text-base">Тьюттори</strong><span className="text-xl font-extrabold">{`${rubles(priceCents)} в месяц`}</span></span> : null}
      <p className="text-sm text-ink-muted">Всё, что есть в кабинете: ученики без ограничений, группы, материалы, статистика, Telegram и push.</p>
      <p className="rounded-xl bg-surface-subtle px-3.5 py-3 text-[13px] text-ink-muted">Оплата картой появится позже. Сейчас продлить можно переводом: напишите нам, и мы продлим доступ после оплаты.</p>
      <Button asChild className="h-11 rounded-xl bg-brand-solid hover:bg-brand-solid-hover"><a href={CONTACT_TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><Send />Продлить через Telegram</a></Button>
      <Button asChild variant="outline" className="h-11 rounded-xl bg-surface dark:bg-surface"><a href={`mailto:${CONTACT_EMAIL}`}><Mail />Написать на почту</a></Button>
    </div>}

    {limited && <div className="border-t border-line">
      <p className="px-4 pt-3 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Когда срок закончится</p>
      <Consequence icon={<Check className="size-4" />} tone="bg-success-soft text-success-ink" title="Все данные сохранятся" text="Ученики, уроки, оплаты и файлы никуда не денутся" />
      <Consequence icon={<Eye className="size-4" />} tone="bg-warning-soft text-warning-ink" title="Кабинет — только для просмотра" text="Нельзя добавлять уроки, оплаты и учеников; напоминания и push не приходят" />
      <Consequence icon={<UsersRound className="size-4" />} tone="bg-brand-soft text-brand-ink" title="Ученики видят своё" text="Расписание и баланс, но без запросов на перенос и «Не приду»" />
    </div>}

    {(limited || payments.length > 0) && <div className="border-t border-line">
      <p className="px-4 pt-3 text-[13px] font-bold uppercase tracking-wide text-ink-muted">Оплаты подписки</p>
      {payments.length ? payments.map((payment) => <div key={payment.id} className="flex items-center justify-between gap-3 px-4 py-3 [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line">
        <span className="flex min-w-0 flex-col gap-0.5"><span className="text-[15px] font-semibold">{`${paidOnDate(payment.paidOn)} · ${methodLabel[payment.method]}`}</span><span className="text-[13px] text-ink-muted">{payment.status === "refunded" ? "Возврат" : `${monthsLabel(payment.months)}, до ${accessDate(payment.accessUntil)}`}</span></span>
        <span className={`shrink-0 text-[15px] font-bold ${payment.status === "refunded" ? "text-ink-muted line-through" : ""}`}>{rubles(payment.amountCents)}</span>
      </div>) : <p className="px-4 py-4 text-center text-sm text-ink-muted">Оплат пока нет. После каждой оплаты здесь появятся дата и сумма.</p>}
    </div>}
  </SettingsGroup>;
}
