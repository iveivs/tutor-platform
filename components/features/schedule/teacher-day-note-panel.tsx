"use client";

import { useState } from "react";
import { StickyNote, Trash2 } from "lucide-react";
import type { TeacherDayNote } from "@/components/features/app/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function TeacherDayNotePanel({ date, note, onSave, compact = false }: { date: string; note?: TeacherDayNote; onSave: (date: string, body: string) => Promise<boolean>; compact?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note?.body ?? "");
  const [pending, setPending] = useState(false);
  const save = async (body: string) => {
    setPending(true);
    const saved = await onSave(date, body);
    setPending(false);
    if (saved) setEditing(false);
  };
  if (!note && !editing) return compact
    ? <Button type="button" variant="outline" size="sm" className="rounded-full border-dashed border-warning-ring bg-warning-soft text-warning-ink hover:bg-warning-soft-strong" onClick={() => setEditing(true)}><StickyNote />Заметка на день</Button>
    : <Button type="button" variant="outline" className="mb-4 w-full justify-start border-dashed text-ink-secondary" onClick={() => setEditing(true)}><StickyNote className="text-amber-500" />Добавить личную заметку на день</Button>;
  return <div className={`${compact ? "basis-full" : "mb-4"} rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-slate-900 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-slate-100`}>
    <div className="flex items-start gap-3"><StickyNote className="mt-0.5 size-5 shrink-0 text-warning-text" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-3"><h3 className="font-bold">Личная заметка на день</h3>{note && !editing && <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>Изменить</Button>}</div><p className="mt-0.5 text-xs text-ink-muted">Видна только вам и не относится к конкретному уроку.</p>{!editing && note && <p data-no-translate className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{note.body}</p>}</div></div>
    {editing && <div className="mt-4"><Textarea value={draft} maxLength={1000} rows={3} autoFocus onChange={(event) => setDraft(event.target.value)} placeholder="Например: распечатать ноты или взять флешку" /><div className="mt-3 flex flex-wrap justify-end gap-2">{note && <Button type="button" variant="ghost" className="mr-auto text-danger-text hover:text-rose-700" disabled={pending} onClick={() => void save("")}><Trash2 />Удалить</Button>}<Button type="button" variant="outline" disabled={pending} onClick={() => { setDraft(note?.body ?? ""); setEditing(false); }}>Отмена</Button><Button type="button" disabled={pending || !draft.trim()} onClick={() => void save(draft)}>{pending ? "Сохраняю…" : "Сохранить заметку"}</Button></div></div>}
  </div>;
}
