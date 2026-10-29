import { Info } from "lucide-react";

// Shown to a student while the teacher's workspace is read-only; nothing about payment.
export function StudentAccessNotice() {
  return <p role="status" className="flex gap-2.5 rounded-2xl bg-brand-soft px-4 py-3 text-[13px] leading-snug text-brand-ink">
    <Info aria-hidden className="mt-0.5 size-[18px] shrink-0" />
    <span>Запросы на перенос и «Не приду» сейчас недоступны. Если планы изменились, напишите преподавателю напрямую.</span>
  </p>;
}
