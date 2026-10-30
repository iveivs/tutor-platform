"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, FileText, Music } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { TeacherMaterial, TeacherMaterialsData } from "@/components/features/app/types";
import { readTeacherMaterials } from "@/components/features/materials/api";
import { formatBytes } from "@/components/features/materials/format";

type Source = "library" | "lesson";

/** The next lesson of this student that has library materials attached, if any. */
function nextLessonMaterials(resources: TeacherMaterial[], studentId: string, now: number) {
  let nextStart = Infinity;
  for (const resource of resources) for (const assignment of resource.assignments ?? []) {
    if (assignment.studentId === studentId && assignment.startsAt >= now && assignment.startsAt < nextStart) nextStart = assignment.startsAt;
  }
  if (nextStart === Infinity) return { startsAt: null, resources: [] as TeacherMaterial[] };
  return { startsAt: nextStart, resources: resources.filter((resource) => resource.assignments?.some((assignment) => assignment.studentId === studentId && assignment.startsAt === nextStart)) };
}

const lessonDate = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

export function DmAttachDialog({ open, onOpenChange, studentId, studentName, onSend }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studentId: string;
  studentName: string;
  onSend: (resourceId: string, caption: string) => Promise<boolean>;
}) {
  const [data, setData] = useState<TeacherMaterialsData | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState<Source>("library");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [caption, setCaption] = useState("");
  const [pending, setPending] = useState(false);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    let active = true;
    void readTeacherMaterials().then((result) => { if (active) { setData(result); setError(""); } }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить библиотеку"); });
    return () => { active = false; };
  }, [open]);

  const lesson = useMemo(() => nextLessonMaterials(data?.resources ?? [], studentId, now), [data, studentId, now]);
  const items = useMemo(() => {
    const list = source === "lesson" ? lesson.resources : data?.resources ?? [];
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return needle ? list.filter((resource) => `${resource.title} ${resource.folder ?? ""}`.toLocaleLowerCase("ru-RU").includes(needle)) : list;
  }, [data, lesson, source, query]);

  const reset = (next: boolean) => {
    if (!next) { setSelectedId(""); setCaption(""); setQuery(""); setSource("library"); }
    onOpenChange(next);
  };
  const send = async () => {
    if (!selectedId) return;
    setPending(true);
    try { if (await onSend(selectedId, caption.trim())) reset(false); } finally { setPending(false); }
  };

  return <Dialog open={open} onOpenChange={reset}>
    <DialogContent className="flex max-h-[min(720px,calc(100dvh-2rem))] flex-col gap-3 sm:max-w-lg">
      <DialogHeader><DialogTitle>Прикрепить материал</DialogTitle><DialogDescription>{`Материал из библиотеки для ${studentName}`}</DialogDescription></DialogHeader>
      <div className="flex gap-1.5" role="group" aria-label="Откуда взять материал">
        {(["library", "lesson"] as const).map((value) => <Button key={value} type="button" size="sm" variant={source === value ? "default" : "outline"} className="rounded-full" aria-pressed={source === value} onClick={() => { setSource(value); setSelectedId(""); }}>{value === "library" ? "Библиотека" : "Ближайший урок"}</Button>)}
      </div>
      {source === "lesson" && lesson.startsAt && <p className="text-xs text-ink-muted">{`Урок ${lessonDate.format(new Date(lesson.startsAt))}`}</p>}
      <Input aria-label="Поиск" placeholder="Найти в библиотеке" value={query} onChange={(event) => setQuery(event.target.value)} />
      <div className="min-h-32 flex-1 overflow-y-auto rounded-xl border border-line">
        {error ? <p className="p-4 text-sm text-danger-text">{error}</p>
          : !data ? <p className="p-4 text-sm text-ink-muted">Загружаю библиотеку…</p>
          : !data.contentRulesAccepted ? <p className="p-4 text-sm text-ink-muted">Сначала примите правила размещения контента в разделе «Материалы».</p>
          : !items.length ? <p className="p-4 text-sm text-ink-muted">{source === "lesson" ? "К ближайшему уроку материалы не прикреплены" : query ? "Ничего не найдено" : "В библиотеке пока нет материалов"}</p>
          : items.map((resource) => {
            const selected = resource.id === selectedId;
            const audio = resource.contentType.startsWith("audio/");
            return <button key={resource.id} type="button" aria-pressed={selected} onClick={() => setSelectedId(selected ? "" : resource.id)} className={`flex w-full items-center gap-3 border-b border-line p-3 text-left last:border-b-0 ${selected ? "bg-brand-soft" : "hover:bg-surface-muted"}`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink-muted">{audio ? <Music className="size-4" /> : <FileText className="size-4" />}</span>
              <span className="flex min-w-0 flex-1 flex-col"><strong className="truncate text-sm" data-no-translate>{resource.title}</strong><span className="text-xs text-ink-muted">{[formatBytes(resource.byteSize), resource.folder].filter(Boolean).join(" · ")}</span></span>
              {selected && <Check className="size-4 shrink-0 text-brand-text" />}
            </button>;
          })}
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Подпись (необязательно)<Input value={caption} maxLength={500} placeholder="Например: выучить к четвергу" onChange={(event) => setCaption(event.target.value)} /></label>
      <p className="text-xs text-ink-muted">Ученик получит доступ к материалу, как через «Выдать ученику»; копия файла не создаётся и место не тратится.</p>
      <DialogFooter><Button type="button" className="w-full sm:w-auto" disabled={!selectedId || pending} onClick={() => void send()}>Отправить в чат</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
