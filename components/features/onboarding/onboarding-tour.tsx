"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { View } from "@/components/features/app/types";
import { useLanguage } from "@/components/language-provider";
import { appFetch } from "@/lib/client-fetch";
import { enablePushOnThisDevice, readPushDeviceState, type PushDeviceState } from "@/lib/push-client";

/** Settings → «Как пользоваться» dispatches this to show the tour again. */
export const REPLAY_TOUR_EVENT = "tyuttori:tour";
export const replayTour = () => window.dispatchEvent(new Event(REPLAY_TOUR_EVENT));

type TourStep = { target?: string; view?: View; title: string; text: string; notify?: boolean };

const TEACHER_STEPS: TourStep[] = [
  { target: "nav-students", title: "Добавьте первого ученика", text: "Во вкладке «Ученики» нажмите «Добавить». Имя и стоимость занятия — этого достаточно. Пригласить ученика в кабинет можно потом, ключ придёт на e-mail родителя или самого ученика." },
  { target: "add-lesson", view: "today", title: "Назначьте урок", text: "Выберите ученика, дату и время. Можно сразу сделать постоянное расписание — например, каждый вторник в 16:00. Ученик получит уведомление." },
  { target: "nav-students", title: "Учитывайте оплаты", text: "В карточке ученика — кнопка «Оплата» и баланс занятий: сразу видно, сколько оплачено и есть ли долг." },
  { target: "nav-materials", title: "Соберите библиотеку", text: "Храните PDF, Word, картинки и MP3 в «Материалах». Прикрепляйте их к урокам, выдавайте ученику или отправляйте в чат скрепкой." },
  { notify: true, title: "Включите уведомления", text: "Запросы учеников, сообщения и напоминания будут приходить на это устройство. Ещё можно подключить Telegram в Настройках." },
];

const STUDENT_STEPS: TourStep[] = [
  { target: "student-next", title: "Ваш ближайший урок", text: "Здесь время урока, материалы к нему и кнопки, чтобы перенести или отменить занятие." },
  { target: "student-contact", title: "Баланс и сообщения", text: "Сколько занятий оплачено и кнопка, чтобы написать преподавателю." },
  { target: "section-materials", title: "Материалы", text: "Документы, ноты и записи от преподавателя со всех уроков собраны в одном месте." },
  { notify: true, title: "Включите уведомления", text: "Переносы, новые материалы и сообщения преподавателя будут приходить на это устройство." },
];

type Rect = { top: number; left: number; width: number; height: number };
const PAD = 6;
const CARD_WIDTH = 380;
const DESKTOP = 1024;

/** The visible element for a tour target: the sidebar and the mobile bar carry the same mark. */
function findTarget(name: string) {
  for (const element of document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)) {
    const rect = element.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return element;
  }
  return null;
}

const sameRect = (a: Rect | null, b: Rect | null) => a === b || Boolean(a && b && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height);

function saveSeen(seen: boolean) {
  return appFetch("/api/onboarding", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ seen }) }).catch(() => undefined);
}

export function OnboardingTour({ role, onNavigate }: { role: "teacher" | "student"; onNavigate?: (view: View) => void }) {
  const steps = role === "student" ? STUDENT_STEPS : TEACHER_STEPS;
  const { language } = useLanguage();
  // -1 closed, 0 welcome, 1… steps.
  const [index, setIndex] = useState(-1);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ width: number; height: number } | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [push, setPush] = useState<{ state: PushDeviceState; publicKey: string | null } | null>(null);
  const [pending, setPending] = useState(false);
  const cardRef = useRef<HTMLElement>(null);
  const step = index > 0 ? steps[index - 1] : null;

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void appFetch("/api/onboarding", { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ seen: boolean }> : null)
        .then((result) => { if (active && result && !result.seen) setIndex(0); }).catch(() => undefined);
    }, 600);
    const replay = () => setIndex(0);
    window.addEventListener(REPLAY_TOUR_EVENT, replay);
    return () => { active = false; window.clearTimeout(timer); window.removeEventListener(REPLAY_TOUR_EVENT, replay); };
  }, []);

  const close = useCallback(() => { setIndex(-1); setRect(null); void saveSeen(true); }, []);
  const go = useCallback((next: number) => {
    if (next > steps.length) { close(); return; }
    const target = next > 0 ? steps[next - 1] : null;
    if (target?.view) onNavigate?.(target.view);
    setRect(null);
    setIndex(Math.max(0, next));
  }, [steps, onNavigate, close]);

  // Follow the target while the page scrolls, resizes or switches tabs.
  useEffect(() => {
    if (index < 0) return;
    let scrolled = false;
    const measure = () => {
      setViewport((current) => current.width === window.innerWidth && current.height === window.innerHeight ? current : { width: window.innerWidth, height: window.innerHeight });
      const element = step?.target ? findTarget(step.target) : null;
      if (element && !scrolled) { scrolled = true; element.scrollIntoView({ block: "center", behavior: "smooth" }); }
      const box = element?.getBoundingClientRect();
      const next = box ? { top: Math.round(box.top) - PAD, left: Math.round(box.left) - PAD, width: Math.round(box.width) + PAD * 2, height: Math.round(box.height) + PAD * 2 } : null;
      setRect((current) => sameRect(current, next) ? current : next);
      const own = cardRef.current?.getBoundingClientRect();
      if (own) setCard((current) => current && current.width === Math.round(own.width) && current.height === Math.round(own.height) ? current : { width: Math.round(own.width), height: Math.round(own.height) });
    };
    measure();
    const timer = window.setInterval(measure, 150);
    return () => window.clearInterval(timer);
  }, [index, step]);

  useEffect(() => {
    if (!step?.notify) return;
    let active = true;
    void readPushDeviceState().then((result) => { if (active) setPush(result); }).catch(() => { if (active) setPush({ state: "unsupported", publicKey: null }); });
    return () => { active = false; };
  }, [step]);

  useEffect(() => {
    if (index < 0) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft" && index > 0) go(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, close]);

  useEffect(() => { if (index >= 0) cardRef.current?.focus({ preventScroll: true }); }, [index]);

  if (index < 0) return null;

  const enablePush = async () => {
    if (!push?.publicKey) { go(index + 1); return; }
    setPending(true);
    try { await enablePushOnThisDevice(push.publicKey, language); } catch { /* the settings card explains failures */ } finally { setPending(false); }
    go(index + 1);
  };

  // Card placement: next to the target on a computer, above or below it on a phone.
  const desktop = viewport.width >= DESKTOP;
  const cardWidth = Math.min(CARD_WIDTH, viewport.width - 32);
  const cardHeight = card?.height ?? 240;
  let cardStyle: React.CSSProperties = { left: (viewport.width - cardWidth) / 2, top: Math.max(16, (viewport.height - cardHeight) / 2), width: cardWidth };
  let arrow: { from: [number, number]; to: [number, number] } | null = null;
  if (rect && step) {
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    if (desktop && rect.left + rect.width + 90 + cardWidth < viewport.width - 16) {
      const top = Math.min(Math.max(16, centerY - 40), viewport.height - cardHeight - 16);
      cardStyle = { left: rect.left + rect.width + 90, top, width: cardWidth };
      arrow = { from: [rect.left + rect.width + 82, top + 34], to: [rect.left + rect.width + 10, centerY] };
    } else if (centerY > viewport.height * 0.5) {
      const top = Math.max(16, rect.top - 90 - cardHeight);
      const left = Math.min(Math.max(16, centerX - cardWidth / 2), viewport.width - cardWidth - 16);
      cardStyle = { left, top, width: cardWidth };
      arrow = { from: [Math.min(left + cardWidth * 0.72, viewport.width - 40), top + cardHeight + 10], to: [centerX, rect.top - 10] };
    } else {
      const top = Math.min(rect.top + rect.height + 90, viewport.height - cardHeight - 16);
      const left = Math.min(Math.max(16, centerX - cardWidth / 2), viewport.width - cardWidth - 16);
      cardStyle = { left, top, width: cardWidth };
      arrow = { from: [Math.min(left + cardWidth * 0.72, viewport.width - 40), top - 10], to: [centerX, rect.top + rect.height + 10] };
    }
  }

  const total = steps.length;
  return <div className="fixed inset-0 z-[70]" role="presentation">
    {rect ? <span aria-hidden className="pointer-events-none fixed rounded-2xl shadow-[0_0_0_200vmax_var(--tour-scrim)] transition-all duration-300" style={rect} />
      : <span aria-hidden className="fixed inset-0 bg-tour-scrim" />}
    {/* Click-blocking layer: the tour is a guide, not a live page. */}
    <span aria-hidden className="fixed inset-0" onClick={(event) => event.stopPropagation()} />
    {rect && <HandRing rect={rect} />}
    {arrow && <HandArrow from={arrow.from} to={arrow.to} />}
    <section ref={cardRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tour-title" style={cardStyle}
      className="fixed flex flex-col gap-2.5 rounded-[20px] bg-surface p-5 text-foreground shadow-2xl outline-none">
      {index === 0 ? <>
        <span aria-hidden className="grid size-14 place-items-center rounded-2xl bg-brand-soft text-3xl">👋</span>
        <h2 id="tour-title" className="text-2xl font-bold">Добро пожаловать в Тьюттори</h2>
        <p className="text-[15px] leading-relaxed text-ink-muted">{role === "student" ? "Покажем главное за минуту: ближайший урок, баланс, материалы и уведомления." : "Покажем главное за минуту: как добавить ученика, назначить урок, учесть оплату и поделиться материалами."}</p>
        <ol className="flex flex-col gap-1.5 rounded-2xl bg-surface-muted px-4 py-3 text-sm">{steps.map((item, number) => <li key={item.title}>{`${number + 1}. `}{item.title}</li>)}</ol>
        <Button type="button" className="mt-1 h-12 rounded-xl text-base" onClick={() => go(1)}>Показать</Button>
        <Button type="button" variant="ghost" className="h-11 rounded-xl text-ink-muted" onClick={close}>Пропустить — разберусь сам</Button>
      </> : step && <>
        <span className="flex items-center justify-between gap-3">
          <span aria-hidden className="flex gap-1.5">{steps.map((item, number) => <span key={item.title} className={`h-1.5 rounded-full ${number + 1 === index ? "w-4 bg-coral" : "w-1.5 bg-line"}`} />)}</span>
          <span className="text-xs text-ink-muted">{`${index} из ${total}`}</span>
        </span>
        <h2 id="tour-title" className="text-xl font-bold">{step.title}</h2>
        <p className="text-[15px] leading-relaxed text-ink-muted">{step.text}</p>
        {step.notify && push?.state === "ios-home-screen" && <p className="flex items-start gap-2.5 rounded-xl bg-surface-muted p-3 text-sm text-ink-muted"><Smartphone className="mt-0.5 size-4 shrink-0" />На iPhone уведомления работают, если Тьюттори добавлен на экран «Домой».</p>}
        {step.notify && push?.state === "on" && <p className="rounded-xl bg-surface-muted p-3 text-sm text-ink-muted">На этом устройстве уведомления уже включены.</p>}
        <span className="mt-1 flex items-center gap-2">
          {desktop && <span className="mr-auto text-xs text-ink-subtle">← → · Esc</span>}
          {step.notify ? <>
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl lg:flex-none" onClick={() => go(index + 1)}>{push?.state === "off" ? "Позже" : "Готово"}</Button>
            {push?.state === "off" && <Button type="button" className="h-11 flex-1 rounded-xl lg:flex-none" disabled={pending} onClick={() => void enablePush()}>Включить</Button>}
          </> : <>
            <Button type="button" variant="outline" className="h-11 flex-1 rounded-xl lg:flex-none" onClick={close}>Пропустить</Button>
            <Button type="button" className="h-11 flex-1 rounded-xl lg:flex-none" onClick={() => go(index + 1)}>Далее</Button>
          </>}
        </span>
        {step.notify && <p className="text-center text-xs text-ink-subtle">Обучение можно повторить в Настройках → «Как пользоваться».</p>}
      </>}
    </section>
  </div>;
}

/** A loose hand-drawn ellipse around the highlighted element. */
function HandRing({ rect }: { rect: Rect }) {
  const w = rect.width + 16;
  const h = rect.height + 16;
  const d = `M${w * 0.55} 4 C ${w * 0.95} 2, ${w - 2} ${h * 0.3}, ${w - 3} ${h / 2} C ${w - 4} ${h - 3}, ${w * 0.7} ${h - 1}, ${w / 2} ${h - 2} C ${w * 0.2} ${h - 3}, 3 ${h * 0.82}, 4 ${h / 2} C 5 ${h * 0.18}, ${w * 0.2} 5, ${w * 0.62} 7`;
  return <svg aria-hidden className="pointer-events-none fixed text-tour-hand" style={{ top: rect.top - 8, left: rect.left - 8 }} width={w} height={h} viewBox={`0 0 ${w} ${h}`} fill="none"><path d={d} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>;
}

/** A curved hand-drawn arrow from the card to the target. */
function HandArrow({ from, to }: { from: [number, number]; to: [number, number] }) {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy) || 1;
  // Bend the line sideways for a drawn feel.
  const bend = Math.min(60, length * 0.3);
  const cx = (x1 + x2) / 2 - (dy / length) * bend;
  const cy = (y1 + y2) / 2 + (dx / length) * bend;
  const angle = Math.atan2(y2 - cy, x2 - cx);
  const head = (offset: number) => `${x2 - 16 * Math.cos(angle + offset)} ${y2 - 16 * Math.sin(angle + offset)}`;
  return <svg aria-hidden className="pointer-events-none fixed inset-0 h-full w-full text-tour-hand" fill="none">
    <path d={`M${x1} ${y1} Q ${cx} ${cy}, ${x2} ${y2}`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    <path d={`M${head(0.45)} L ${x2} ${y2} L ${head(-0.45)}`} stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
