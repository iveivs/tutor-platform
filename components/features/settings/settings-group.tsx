import type { ReactNode } from "react";

// Grouped list card used by the v2 settings screen.
export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex flex-col gap-2">
    <h2 className="px-1 pt-2 text-[13px] font-bold uppercase tracking-wide text-ink-muted">{title}</h2>
    <div className="overflow-hidden rounded-2xl border border-line bg-surface">{children}</div>
  </section>;
}

export const settingsRowClass = "flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left [&:not(:last-child)]:border-b [&:not(:last-child)]:border-line";
