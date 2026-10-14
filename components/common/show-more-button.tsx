import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function ShowMoreButton({ expanded, remaining, onToggle, className }: { expanded: boolean; remaining: number; onToggle: () => void; className?: string }) {
  return <Button type="button" variant="outline" className={cn("w-full", className)} aria-expanded={expanded} onClick={onToggle}>
    {expanded ? <ChevronUp /> : <ChevronDown />}
    {expanded ? "Свернуть" : `Показать ещё ${remaining}`}
  </Button>;
}
