import type { Lesson } from "@/components/features/app/types";

export const lessonStatusStyles: Record<Lesson["status"], string> = {
  paid: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  low: "bg-indigo-50 text-indigo-700 ring-indigo-100",
  debt: "bg-rose-50 text-rose-700 ring-rose-100",
  request: "bg-amber-50 text-amber-700 ring-amber-100",
  trial: "bg-sky-50 text-sky-700 ring-sky-100",
};
