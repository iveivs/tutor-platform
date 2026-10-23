import { CalendarDays } from "lucide-react";

export function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-ink-muted"><div><CalendarDays className="mx-auto mb-3 size-7 text-ink-faint" /><p>{text}</p></div></div>;
}
