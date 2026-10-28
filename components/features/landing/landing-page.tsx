"use client";

import { useState, type ComponentType } from "react";
import { ArrowRight, BookOpen, CalendarDays, ChartColumn, Gift, Globe, LogIn, Music, PenLine, Send, Smartphone, Users, Wallet } from "lucide-react";
import { BrandIcon } from "@/components/brand-icon";
import { LegalLinks } from "@/components/legal-links";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { StartDialog } from "@/components/features/landing/start-dialog";

type Icon = ComponentType<{ className?: string }>;

const audiences: [Icon, string][] = [[PenLine, "Репетиторы"], [Music, "Преподаватели музыки"], [Globe, "Преподаватели языков"]];

const features: [Icon, string, string][] = [
  [CalendarDays, "Расписание", "Постоянное и плавающее. Уроки по постоянному расписанию создаются сами на 90 дней вперёд. День, неделя, месяц."],
  [Wallet, "Баланс и оплаты", "Разовая оплата или абонемент. Занятие списывается после урока, цена и долг видны сразу."],
  [Smartphone, "Кабинет ученика", "Ближайший урок, баланс и история оплат. Запрос переноса и «Не\u00a0приду» до 23:59 накануне."],
  [BookOpen, "Материалы и домашние задания", "Файлы к уроку и своя библиотека материалов. Ученик видит задание у себя в кабинете."],
  [Users, "Групповые занятия", "Постоянные группы, например хор два раза в неделю. Каждый платит за себя и отменяет только своё занятие."],
  [Send, "Telegram", "Напоминания об уроках и запросы учеников приходят в Telegram. Подключается по желанию."],
  [ChartColumn, "Статистика", "Уроки, деньги, рабочие дни, новые ученики и паузы за выбранный период."],
  [Gift, "Пробные занятия", "Бесплатный пробный урок для нового человека, без лишних записей в списке учеников."],
];

const steps: [string, string][] = [
  ["Напишите нам", "Мы пришлём персональную ссылку на кабинет преподавателя."],
  ["Добавьте учеников", "Расписание, цену урока и первую оплату можно указать сразу."],
  ["Пригласите учеников", "Каждый получает свою ссылку и видит только свои уроки и баланс."],
];

const container = "mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-10";
const primaryButton = "h-12 rounded-xl bg-brand-solid px-5 text-base shadow-lg shadow-brand-glow hover:bg-brand-solid-hover";
const outlineButton = "h-12 rounded-xl bg-surface px-5 text-base dark:bg-surface";

// What a signed-out visitor sees at tyuttori.ru: a short product story with «Войти» and «Начать».
export function LandingPage({ onLogin }: { onLogin: () => void }) {
  const [starting, setStarting] = useState(false);
  const actions = <div className="grid gap-3 sm:flex">
    <Button type="button" onClick={() => setStarting(true)} className={primaryButton}>Начать<ArrowRight /></Button>
    <Button type="button" variant="outline" onClick={onLogin} className={outlineButton}><LogIn />Войти</Button>
  </div>;

  return (
    <main className="min-h-dvh bg-background text-ink-body">
      <header className={`${container} flex items-center gap-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]`}>
        <BrandIcon className="size-9" />
        <span className="text-lg font-bold text-ink-strong">Тьюттори</span>
        <span className="flex-1" />
        <ThemeToggle compact />
        <Button type="button" variant="ghost" onClick={onLogin} className="h-10 rounded-xl px-3 text-base font-semibold text-brand-text">Войти</Button>
      </header>

      <section className={`${container} grid gap-5 pb-8 pt-5 md:pb-16 md:pt-14`}>
        <BrandIcon className="size-16 shadow-lg" />
        <h1 className="max-w-[18ch] text-balance text-[2rem] font-bold leading-tight tracking-tight text-ink-strong md:text-5xl">Расписание, оплаты и ученики в одном кабинете</h1>
        <p className="max-w-[52ch] text-base text-ink-muted md:text-lg">Тьюттори помогает частному преподавателю вести уроки без таблиц и переписки: вы видите расписание и баланс каждого ученика, а ученик сам смотрит свои занятия и предупреждает об отмене.</p>
        <ul className="flex flex-wrap gap-2">
          {audiences.map(([AudienceIcon, label]) => <li key={label} className="inline-flex items-center gap-2 rounded-full bg-surface-muted px-3 py-1.5 text-sm font-medium"><AudienceIcon className="size-4 text-brand-text" />{label}</li>)}
        </ul>
        {actions}
      </section>

      <section className="border-y border-line bg-surface-subtle">
        <div className={`${container} py-10 md:py-14`}>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">Что умеет</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink-strong md:text-3xl">Всё, что нужно для частных уроков</h2>
          <ul className="mt-6 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
            {features.map(([FeatureIcon, title, text]) => <li key={title} className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1 rounded-[var(--radius-card)] border border-line bg-surface p-4 lg:grid-cols-1">
              <span className="row-span-2 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-ink lg:row-span-1 lg:mb-2"><FeatureIcon className="size-5" /></span>
              <h3 className="font-semibold text-ink-strong">{title}</h3>
              <p className="min-w-0 text-sm text-ink-muted">{text}</p>
            </li>)}
          </ul>
        </div>
      </section>

      <section className={`${container} py-10 md:py-14`}>
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-text">Как начать</p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-ink-strong md:text-3xl">Три шага до первого урока</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3 md:gap-6">
          {steps.map(([title, text], index) => <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-x-4 gap-y-0.5">
            <span className="row-span-2 grid size-10 place-items-center rounded-full border-2 border-brand-line font-bold tabular-nums text-brand-text">{index + 1}</span>
            <h3 className="pt-2 font-semibold text-ink-strong">{title}</h3>
            <p className="text-sm text-ink-muted">{text}</p>
          </li>)}
        </ol>
      </section>

      <section className={`${container} pb-10`}>
        <div className="card grid gap-4 rounded-[20px] p-5 sm:p-7 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-ink-strong md:text-2xl">Попробуйте на своих учениках</h2>
            <p className="mt-1 text-ink-muted">Работает в браузере на телефоне и компьютере, можно добавить на главный экран.</p>
          </div>
          {actions}
        </div>
      </section>

      <footer className={`${container} grid gap-3 border-t border-line pb-[max(2rem,env(safe-area-inset-bottom))] pt-6 md:grid-cols-[1fr_auto] md:items-center`}>
        <LegalLinks className="md:justify-start!" />
        <small className="text-xs text-ink-subtle">© Тьюттори</small>
      </footer>

      <StartDialog open={starting} onOpenChange={setStarting} />
    </main>
  );
}
