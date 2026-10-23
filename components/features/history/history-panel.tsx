"use client";

import { useState } from "react";

import { ShowMoreButton } from "@/components/common/show-more-button";
import type { HistoryEvent, Student } from "@/components/features/app/types";
import { HistoryTimeline } from "@/components/features/history/history-lists";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const categories: Array<{ value: "all" | HistoryEvent["category"]; label: string }> = [
  { value: "all", label: "Все" },
  { value: "lesson", label: "Уроки" },
  { value: "payment", label: "Баланс" },
  { value: "request", label: "Запросы" },
];

export function HistoryPanel({ events, students, onReversePayment }: { events: HistoryEvent[]; students: Student[]; onReversePayment: (id: string) => Promise<boolean> }) {
  const [category, setCategory] = useState<"all" | HistoryEvent["category"]>("all");
  const [studentId, setStudentId] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const filteredEvents = events.filter((event) => (category === "all" || event.category === category) && (studentId === "all" || event.studentId === studentId));
  const visibleEvents = expanded ? filteredEvents : filteredEvents.slice(0, 3);

  return <>
    <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {categories.map((item) => <Button key={item.value} type="button" size="control" variant={category === item.value ? "default" : "outline"} className="whitespace-nowrap" onClick={() => { setCategory(item.value); setExpanded(false); }}>{item.label}</Button>)}
      </div>
      <Select value={studentId} onValueChange={(value) => { setStudentId(value); setExpanded(false); }}><SelectTrigger className="h-[var(--control-height)] w-full rounded-[var(--radius-control)] bg-surface dark:bg-surface xl:w-72" aria-label="Ученик"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все ученики</SelectItem>{students.map((student) => <SelectItem key={student.id} value={student.id}>{student.name}</SelectItem>)}</SelectContent></Select>
    </div>
    <HistoryTimeline events={visibleEvents} onReversePayment={onReversePayment} />
    {filteredEvents.length > 3 && <ShowMoreButton expanded={expanded} remaining={filteredEvents.length - 3} className="mt-3" onToggle={() => setExpanded((value) => !value)} />}
  </>;
}
