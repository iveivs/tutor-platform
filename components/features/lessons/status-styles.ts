import type { Lesson } from "@/components/features/app/types";

const lessonStatusStyles: Record<Lesson["status"], string> = {
  paid: "bg-success-soft text-success-ink ring-success-ring",
  low: "bg-brand-soft text-brand-ink ring-brand-ring",
  debt: "bg-danger-soft text-danger-ink ring-danger-ring",
  request: "bg-warning-soft text-warning-ink ring-warning-ring",
  trial: "bg-sky-50 text-sky-700 ring-sky-100",
};

export function lessonStatusStyle(lesson: Pick<Lesson, "status" | "past">) {
  if (lesson.past && lesson.status === "paid") return "bg-emerald-100 text-emerald-950 ring-emerald-300 dark:bg-emerald-950/55 dark:text-emerald-100 dark:ring-emerald-800";
  if (lesson.past && (lesson.status === "debt" || lesson.status === "low")) return "bg-rose-100 text-rose-950 ring-rose-300 dark:bg-rose-950/55 dark:text-rose-100 dark:ring-rose-800";
  if (!lesson.past && lesson.status === "paid") return "bg-emerald-700 text-white ring-emerald-800 dark:bg-emerald-800 dark:text-emerald-50 dark:ring-emerald-700";
  if (!lesson.past && (lesson.status === "debt" || lesson.status === "low")) return "bg-rose-700 text-white ring-rose-800 dark:bg-rose-800 dark:text-rose-50 dark:ring-rose-700";
  return lessonStatusStyles[lesson.status];
}
