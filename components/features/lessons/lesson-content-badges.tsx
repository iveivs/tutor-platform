import { Paperclip, StickyNote } from "lucide-react";
import type { Lesson } from "@/components/features/app/types";

export function LessonContentBadges({ lesson, compact = false, className = "mt-2 flex flex-wrap gap-1.5" }: { lesson: Pick<Lesson, "hasFile" | "hasNote">; compact?: boolean; className?: string }) {
  if (!lesson.hasFile && !lesson.hasNote) return null;
  return <span className={className}>
    {lesson.hasFile && <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-1 text-[11px] font-semibold text-brand-ink" title="Есть прикреплённый файл"><Paperclip className="size-3" />{!compact && "Файл"}</span>}
    {lesson.hasNote && <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200" title="Есть заметка"><StickyNote className="size-3" />{!compact && "Заметка"}</span>}
  </span>;
}
