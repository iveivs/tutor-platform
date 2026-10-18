import { Paperclip, StickyNote } from "lucide-react";
import type { Lesson } from "@/components/features/app/types";

export function LessonContentBadges({ lesson, compact = false }: { lesson: Pick<Lesson, "hasFile" | "hasNote">; compact?: boolean }) {
  if (!lesson.hasFile && !lesson.hasNote) return null;
  return <span className="mt-2 flex flex-wrap gap-1.5">
    {lesson.hasFile && <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-1 text-[11px] font-semibold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" title="Есть прикреплённый файл"><Paperclip className="size-3" />{!compact && "Файл"}</span>}
    {lesson.hasNote && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200" title="Есть заметка"><StickyNote className="size-3" />{!compact && "Заметка"}</span>}
  </span>;
}
