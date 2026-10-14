"use client";

import { useState } from "react";

import { AppCard, AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { Button } from "@/components/ui/button";

export type AvailabilityAccessStudent = {
  id: string;
  name: string;
  email?: string;
  canViewAvailability: boolean;
};

export function StudentAvailabilityAccessCard({ student, onUpdate }: { student: AvailabilityAccessStudent; onUpdate: (student: AvailabilityAccessStudent) => Promise<boolean> }) {
  const [pending, setPending] = useState(false);

  const toggle = async () => {
    setPending(true);
    try {
      await onUpdate({ ...student, canViewAvailability: !student.canViewAvailability });
    } finally {
      setPending(false);
    }
  };

  return <AppCard>
    <div className="flex items-start justify-between gap-4">
      <div>
        <AppCardTitle>Доступ к свободным слотам</AppCardTitle>
        <AppCardDescription className="leading-6">Ученик сможет открыть список свободных рабочих часов и отправить запрос на выбранное время.</AppCardDescription>
      </div>
      <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${student.canViewAvailability ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
        {student.canViewAvailability ? "Разрешён" : "Запрещён"}
      </span>
    </div>
    <Button type="button" size="control" variant={student.canViewAvailability ? "outline" : "default"} className="mt-5 w-full" disabled={pending} onClick={() => void toggle()}>
      {student.canViewAvailability ? "Закрыть доступ" : "Показывать свободные слоты"}
    </Button>
  </AppCard>;
}
