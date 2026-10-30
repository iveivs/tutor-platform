"use client";

import { useState } from "react";
import { BookmarkPlus, FileText, Music, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { MaterialPreviewItem } from "@/components/features/materials/material-preview-dialog";
import { appFetch } from "@/lib/client-fetch";

export type LessonFile = { id: string; filename: string; contentType: string; byteSize: number; authorName: string; mine: boolean; canDelete: boolean; canSaveToLibrary?: boolean; expiresAt: number; createdAt: number; url: string };

const size = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} МБ`;
const daysLeft = (expiresAt: number) => Math.max(0, Math.ceil((expiresAt - Date.now()) / 86_400_000));

// Audio recordings (MP3) and documents attached to a lesson by the teacher or a student. They are
// removed 90 days after the lesson, like photos.
export function LessonFilesSection({ lessonId, files, storageConfigured, onChanged, onPreview }: { lessonId: string; files: LessonFile[]; storageConfigured: boolean; onChanged: () => Promise<void> | void; onPreview: (item: MaterialPreviewItem) => void }) {
  const [pending, setPending] = useState(false);
  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setPending(true);
    try {
      for (const file of Array.from(list)) {
        const form = new FormData(); form.set("lessonId", lessonId); form.set("file", file);
        const response = await appFetch("/api/lesson-materials/files", { method: "POST", body: form });
        if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось загрузить файл");
      }
      toast.success("Файл добавлен"); await onChanged();
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось загрузить файл"); }
    finally { setPending(false); }
  };
  const save = async (file: LessonFile) => {
    const response = await appFetch(`/api/lesson-materials/files?id=${encodeURIComponent(file.id)}`, { method: "PUT" });
    if (response.ok) toast.success("Сохранено в библиотеку — файл больше не удалится через 90 дней");
    else toast.error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось сохранить в библиотеку");
  };
  const remove = async (file: LessonFile) => {
    if (!window.confirm(`Удалить «${file.filename}»?`)) return;
    const response = await appFetch(`/api/lesson-materials/files?id=${encodeURIComponent(file.id)}`, { method: "DELETE" });
    if (response.ok) { toast.success("Файл удалён"); await onChanged(); } else toast.error("Не удалось удалить файл");
  };
  return <section>
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h3 className="font-bold">Аудио и документы</h3><p className="mt-1 text-sm text-ink-muted">MP3 до 20 МБ, PDF или Word до 10 МБ. Удаляются через 90 дней после урока.</p></div>
      {storageConfigured && <label className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-4 text-sm font-semibold ${pending ? "pointer-events-none opacity-60" : "hover:bg-surface-subtle"}`}><Paperclip className="size-4" />{pending ? "Загружаю…" : "Добавить файл"}<input type="file" className="sr-only" multiple accept=".mp3,audio/mpeg,.pdf,application/pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" disabled={pending} onChange={(event) => { void upload(event.target.files); event.target.value = ""; }} /></label>}
    </div>
    {files.length > 0 ? <div className="mt-4 divide-y overflow-hidden rounded-2xl border border-line">{files.map((file) => {
      const audio = file.contentType.startsWith("audio/");
      return <article key={file.id} className="flex items-center gap-3 p-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-text">{audio ? <Music className="size-5" /> : <FileText className="size-5" />}</span>
        <button type="button" className="flex min-w-0 flex-1 flex-col text-left" onClick={() => onPreview({ title: file.filename, filename: file.filename, contentType: file.contentType, url: file.url, downloadUrl: `${file.url}?download=1` })}>
          <strong className="truncate text-[15px]" data-no-translate>{file.filename}</strong>
          <span className="truncate text-xs text-ink-muted">{`${file.authorName} · ${size(file.byteSize)} · удалится через ${daysLeft(file.expiresAt)} дн.`}</span>
        </button>
        {file.canSaveToLibrary && <Button type="button" size="icon" variant="ghost" className="shrink-0 text-ink-muted" aria-label="Сохранить в библиотеку" title="Сохранить в библиотеку" onClick={() => void save(file)}><BookmarkPlus className="size-4" /></Button>}
        {file.canDelete && <Button type="button" size="icon" variant="ghost" className="shrink-0 text-ink-muted" aria-label="Удалить файл" onClick={() => void remove(file)}><Trash2 className="size-4" /></Button>}
      </article>;
    })}</div> : <p className="mt-3 rounded-xl bg-surface-subtle p-4 text-sm text-ink-muted">Пока нет файлов. Можно записать, как играете упражнение, и добавить сюда.</p>}
  </section>;
}
