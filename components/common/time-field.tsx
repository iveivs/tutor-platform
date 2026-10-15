"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function TimeField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const shift = (hours: number) => {
    const [rawHours, rawMinutes] = value.split(":").map(Number);
    if (!Number.isFinite(rawHours) || !Number.isFinite(rawMinutes)) return;
    onChange(`${String((rawHours + hours + 24) % 24).padStart(2, "0")}:${String(rawMinutes).padStart(2, "0")}`);
  };
  return <div className="flex min-w-0 gap-2"><Button type="button" variant="outline" size="icon" aria-label="Уменьшить время на час" onClick={() => shift(-1)} className="h-11 shrink-0 rounded-xl"><Minus className="size-4" /></Button><Input aria-label="Время" type="time" step="3600" value={value} onChange={(event) => onChange(event.target.value)} className="h-11 min-w-0 rounded-xl text-center" /><Button type="button" variant="outline" size="icon" aria-label="Увеличить время на час" onClick={() => shift(1)} className="h-11 shrink-0 rounded-xl"><Plus className="size-4" /></Button></div>;
}
