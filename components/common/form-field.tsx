import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

export function FormField({ label, children }: { label: string; children: ReactNode }) {
  const required = label.endsWith(" *");
  const visibleLabel = required ? label.slice(0, -2) : label;
  return <div className="min-w-0 space-y-2"><Label className={required ? "font-semibold text-primary" : undefined}>{visibleLabel}{required && <span aria-hidden="true"> *</span>}</Label>{children}</div>;
}
