import { CalendarDays } from "lucide-react";

export function EmptyState({ text }: { text: string }) {
  return <div className="grid min-h-36 place-items-center p-6 text-center text-slate-500"><div><CalendarDays className="mx-auto mb-3 size-7 text-slate-300" /><p>{text}</p></div></div>;
}
