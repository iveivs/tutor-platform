"use client";

import { useMemo, useState } from "react";
import { Share2, UserRoundCheck, X } from "lucide-react";
import { SearchableSelect } from "@/components/common/searchable-select";
import type { TeacherMaterial } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function ShareMaterialDialog({
  resource,
  students,
  pending,
  onShare,
  onUnshare,
}: {
  resource: TeacherMaterial;
  students: { id: string; name: string }[];
  pending: boolean;
  onShare: (resource: TeacherMaterial, studentId: string) => Promise<boolean>;
  onUnshare: (resource: TeacherMaterial, studentId: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [studentId, setStudentId] = useState("");
  const sharedIds = useMemo(() => new Set((resource.sharedStudents ?? []).map((student) => student.studentId)), [resource.sharedStudents]);
  const availableStudents = students.filter((student) => !sharedIds.has(student.id));
  const share = async () => {
    if (!studentId) return;
    if (await onShare(resource, studentId)) setStudentId("");
  };

  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline"><Share2 />Поделиться</Button></DialogTrigger>
    <DialogContent className="rounded-3xl sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Поделиться материалом</DialogTitle>
        <DialogDescription>Выберите ученика. Файл останется в библиотеке в одном экземпляре, ученику откроется защищённый доступ.</DialogDescription>
      </DialogHeader>
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SearchableSelect
            value={studentId}
            onValueChange={setStudentId}
            items={availableStudents.map((student) => ({ value: student.id, label: student.name }))}
            disabled={!availableStudents.length}
            placeholder={availableStudents.length ? "Найти ученика" : "Материал уже доступен всем ученикам"}
            searchPlaceholder="Поиск по имени ученика"
            emptyText="Ученик не найден"
          />
          <Button type="button" className="shrink-0 bg-brand-solid" disabled={pending || !studentId} onClick={() => void share()}><Share2 />Отправить</Button>
        </div>
        <section>
          <h3 className="text-sm font-bold">Прямой доступ</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">Отдельные назначения ученикам, не привязанные к конкретному уроку.</p>
          {(resource.sharedStudents ?? []).length ? <ul className="mt-3 divide-y overflow-hidden rounded-2xl border">
            {(resource.sharedStudents ?? []).map((student) => <li key={student.studentId} className="flex items-center gap-3 px-4 py-3">
              <UserRoundCheck className="size-4 shrink-0 text-brand-text" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{student.studentName}</span>
              <Button type="button" size="icon-sm" variant="ghost" disabled={pending} aria-label={`Закрыть доступ для ${student.studentName}`} onClick={() => void onUnshare(resource, student.studentId)}><X /></Button>
            </li>)}
          </ul> : <p className="mt-3 rounded-2xl border border-dashed p-5 text-center text-sm text-ink-muted">Материал пока не отправлен напрямую ни одному ученику.</p>}
        </section>
      </div>
    </DialogContent>
  </Dialog>;
}
