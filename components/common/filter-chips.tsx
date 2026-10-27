"use client";

// Row of pill filters. On phones the row scrolls; from md up every pill gets the same minimum width.
export function FilterChips<T extends string>({ items, value, onChange, label }: { items: ReadonlyArray<{ value: T; label: string }>; value: T; onChange: (value: T) => void; label?: string }) {
  return <div role="group" aria-label={label} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:flex-wrap md:gap-2 md:px-0">
    {items.map((item) => <button key={item.value} type="button" aria-pressed={value === item.value} onClick={() => onChange(item.value)} className={`inline-flex h-9 shrink-0 items-center justify-center rounded-full px-3 text-sm font-semibold transition md:min-w-28 md:px-4 ${value === item.value ? "bg-brand-solid text-white" : "border border-line bg-surface text-ink-muted hover:text-foreground"}`}>{item.label}</button>)}
  </div>;
}
