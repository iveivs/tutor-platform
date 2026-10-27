import type { ReactNode } from "react";

import { Typography } from "@/components/ui/typography";

export function AppShell({ eyebrow, title, actions, actionsInline = false, headerClassName = "", children }: { eyebrow?: string; title: string; actions?: ReactNode; actionsInline?: boolean; headerClassName?: string; children: ReactNode }) {
  return <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8 md:py-9 xl:px-12">
    <div className={`${actionsInline ? "mb-6 flex items-end justify-between gap-4" : "mb-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between"} ${headerClassName}`}>
      <div>
        {eyebrow && <p className="mb-1 text-sm font-semibold text-coral-text">{eyebrow}</p>}
        <Typography variant="pageTitle" asChild><h1>{title}</h1></Typography>
      </div>
      {actions}
    </div>
    {children}
  </div>;
}
