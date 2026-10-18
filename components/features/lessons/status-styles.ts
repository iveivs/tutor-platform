import type { Lesson } from "@/components/features/app/types";

const lessonStatusStyles: Record<Lesson["status"], string> = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  low: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  debt: "bg-rose-50 text-rose-700 ring-rose-100",
  request: "bg-amber-50 text-amber-700 ring-amber-100",
  trial: "bg-sky-50 text-sky-700 ring-sky-100",
};

export function lessonStatusStyle(lesson: Pick<Lesson, "status" | "past">) {
  if (lesson.past && lesson.status === "paid") return "bg-emerald-50/55 text-emerald-700 ring-emerald-100 dark:bg-emerald-950/25 dark:text-emerald-300 dark:ring-emerald-900";
  if (lesson.past && (lesson.status === "debt" || lesson.status === "low")) return "bg-rose-50/55 text-rose-700 ring-rose-100 dark:bg-rose-950/25 dark:text-rose-300 dark:ring-rose-900";
  if (!lesson.past && lesson.status === "paid") return "bg-emerald-100 text-emerald-800 ring-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200 dark:ring-emerald-800";
  if (!lesson.past && (lesson.status === "debt" || lesson.status === "low")) return "bg-rose-100 text-rose-800 ring-rose-200 dark:bg-rose-950/70 dark:text-rose-200 dark:ring-rose-800";
  return lessonStatusStyles[lesson.status];
}
