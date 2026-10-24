import type { Lesson } from "@/components/features/app/types";

// Future lessons: "low" is not covered by prepayment yet, "debt" means the balance is already negative.
const lessonStatusStyles: Record<Lesson["status"], string> = {
  paid: "bg-status-paid text-status-paid-ink ring-status-paid-ring",
  low: "bg-status-unpaid text-status-unpaid-ink ring-status-unpaid-ring",
  debt: "bg-status-debt text-status-debt-ink ring-status-debt-ring",
  request: "bg-status-request text-status-request-ink ring-status-request-ring",
  trial: "bg-status-trial text-status-trial-ink ring-status-trial-ring",
};

export function lessonStatusStyle(lesson: Pick<Lesson, "status" | "past">) {
  if (lesson.past && lesson.status === "paid") return "bg-status-past-paid text-status-past-paid-ink ring-status-past-paid-ring";
  if (lesson.past && (lesson.status === "debt" || lesson.status === "low")) return "bg-status-past-debt text-status-past-debt-ink ring-status-past-debt-ring";
  return lessonStatusStyles[lesson.status];
}
