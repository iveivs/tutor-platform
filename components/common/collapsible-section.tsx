"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { preferenceKey, readPreference, writePreference } from "@/lib/client-preferences";

export function CollapsibleSection({ scope, id, title, description, icon: Icon, badge, children, defaultOpen = false, className = "" }: {
  scope: string;
  id: string;
  title: string;
  description?: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const stored = readPreference(preferenceKey(scope, `section-${id}`));
      if (stored === "open" || stored === "closed") setOpen(stored === "open");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [id, scope]);

  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      writePreference(preferenceKey(scope, `section-${id}`), next ? "open" : "closed");
      return next;
    });
  };

  return <section className={`card min-w-0 overflow-hidden ${className}`}>
    <button type="button" className="flex w-full items-center gap-3 p-5 text-left transition hover:bg-slate-50 dark:hover:bg-slate-900/50 md:p-6" aria-expanded={open} aria-controls={`${id}-content`} onClick={toggle}>
      {Icon && <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><Icon className="size-5" /></span>}
      <span className="min-w-0 flex-1"><AppCardTitle>{title}</AppCardTitle>{description && <AppCardDescription>{description}</AppCardDescription>}</span>
      {badge}
      <ChevronDown className={`size-5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
    {open && <div id={`${id}-content`} className="border-t border-slate-200 p-5 dark:border-slate-700 md:p-6">{children}</div>}
  </section>;
}
