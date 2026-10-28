"use client";
/* eslint-disable @next/next/no-img-element -- protected lesson photos are already resized server-side and require the viewer's session cookie. */

import { useCallback, useEffect, useState } from "react";
import { Camera, Download, Eye, FileText, Image as ImageIcon, Link2, Trash2, Unlink, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Lesson, LessonMaterialsData } from "@/components/features/app/types";
import { SearchableSelect } from "@/components/common/searchable-select";
import { readLessonMaterials, saveLessonMaterial } from "@/components/features/materials/api";
import { formatBytes, isImageMaterial } from "@/components/features/materials/format";
import { MaterialPreviewDialog, type MaterialPreviewItem } from "@/components/features/materials/material-preview-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/client-fetch";
import { dateTitle } from "@/lib/date-time";

export function LessonMaterialsDialog({ lesson, role, onOpenChange }: { lesson: Lesson | null; role: "owner" | "teacher" | "student"; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<LessonMaterialsData | null>(null);
  const [sharedNote, setSharedNote] = useState("");
  const [privateNote, setPrivateNote] = useState("");
  const [homeworkAssignment, setHomeworkAssignment] = useState("");
  const [homeworkResponse, setHomeworkResponse] = useState("");
  const [selectedResource, setSelectedResource] = useState("");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<MaterialPreviewItem | null>(null);
  const load = useCallback(async () => {
    if (!lesson) return;
    const next = await readLessonMaterials(lesson.id);
    setData(next);
    setSharedNote(next.notes.find((note) => note.mine && note.visibility === "shared")?.body ?? "");
    setPrivateNote(next.notes.find((note) => note.mine && note.visibility === "teacher_private")?.body ?? "");
    setHomeworkAssignment(next.homework.assignment);
    setHomeworkResponse(next.homework.studentResponse);
  }, [lesson]);
  useEffect(() => {
    if (!lesson) return;
    let active = true;
    void readLessonMaterials(lesson.id).then((next) => {
      if (!active) return;
      setData(next);
      setSharedNote(next.notes.find((note) => note.mine && note.visibility === "shared")?.body ?? "");
      setPrivateNote(next.notes.find((note) => note.mine && note.visibility === "teacher_private")?.body ?? "");
      setHomeworkAssignment(next.homework.assignment);
      setHomeworkResponse(next.homework.studentResponse);
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить материалы"));
    return () => { active = false; };
  }, [lesson]);
  const acceptRules = async () => {
    if (!acceptedRules) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "acceptContentRules", accepted: true }); await load(); toast.success("Правила приняты"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить согласие"); }
    finally { setPending(false); }
  };
  const saveNote = async (visibility: "shared" | "teacher_private", body: string) => {
    if (!lesson || !body.trim()) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "upsertNote", lessonId: lesson.id, visibility, body: body.trim() }); await load(); toast.success("Заметка сохранена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить заметку"); }
    finally { setPending(false); }
  };
  const saveHomework = async (field: "assignment" | "student_response", body: string) => {
    if (!lesson) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "updateHomework", lessonId: lesson.id, field, body }); await load(); toast.success(body.trim() ? "Домашнее задание сохранено" : "Текст домашнего задания удалён"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить домашнее задание"); }
    finally { setPending(false); }
  };
  const removeNote = async (noteId: string) => {
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "deleteNote", noteId }); await load(); toast.success("Заметка удалена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить заметку"); }
    finally { setPending(false); }
  };
  const uploadPhotos = async (files: FileList | null) => {
    if (!lesson || !files?.length) return;
    if (files.length > (data?.maxPhotosPerParticipant ?? 5) - (data?.attachments.filter((photo) => photo.mine).length ?? 0)) {
      setError("К одному уроку можно добавить не более 5 фотографий от каждого участника");
      return;
    }
    if (Array.from(files).some((file) => file.size > 5 * 1024 * 1024)) {
      setError("Размер каждой фотографии не должен превышать 5 МБ");
      return;
    }
    setPending(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData(); form.set("lessonId", lesson.id); form.set("file", file);
        const response = await appFetch("/api/lesson-materials/photos", { method: "POST", body: form });
        const result = await response.json() as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить фотографию");
      }
      await load(); toast.success(files.length === 1 ? "Фотография добавлена" : "Фотографии добавлены");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить фотографию"); }
    finally { setPending(false); }
  };
  const removePhoto = async (attachmentId: string) => {
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "deleteAttachment", attachmentId }); await load(); toast.success("Фотография удалена"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить фотографию"); }
    finally { setPending(false); }
  };
  const changeResourceLink = async (resourceId: string, attach: boolean) => {
    if (!lesson) return;
    setPending(true); setError("");
    try {
      await saveLessonMaterial({ action: attach ? "attachResource" : "detachResource", lessonId: lesson.id, resourceId });
      setSelectedResource(""); await load(); toast.success(attach ? "Документ добавлен к уроку" : "Документ откреплён от урока");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось изменить документы урока"); }
    finally { setPending(false); }
  };
  const sharedMine = data?.notes.find((note) => note.mine && note.visibility === "shared");
  const privateMine = data?.notes.find((note) => note.mine && note.visibility === "teacher_private");
  const otherNotes = data?.notes.filter((note) => !note.mine && note.visibility === "shared") ?? [];
  const minePhotoCount = data?.attachments.filter((photo) => photo.mine).length ?? 0;
  const linkedResourceIds = new Set(data?.documents.map((document) => document.id) ?? []);
  const availableResources = data?.library.filter((resource) => !linkedResourceIds.has(resource.id)) ?? [];
  return <><Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-3xl"><DialogHeader><DialogTitle className="text-2xl">Материалы урока</DialogTitle><DialogDescription>{lesson ? `${lesson.className ?? lesson.name} · ${dateTitle(lesson.date, { day: "numeric", month: "long", year: "numeric" })}, ${lesson.time}` : "Заметки, документы и фотографии"}</DialogDescription></DialogHeader>
      {lesson?.classId && role !== "student" && <p className="rounded-2xl bg-brand-soft p-3 text-sm text-brand-ink-strong">Документы, задание, общую заметку и ваши фотографии увидят все участники группы. Личная заметка видна только вам, а заметки, фотографии и ответы учеников — вам и самому ученику.</p>}
    {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</p>}
    {!data && !error && <p className="py-10 text-center text-ink-muted">Загружаю материалы…</p>}
    {data && !data.contentRulesAccepted && <section className="rounded-2xl border border-brand-line bg-brand-soft p-5"><h3 className="font-bold text-indigo-950">Правила пользовательского контента</h3><p className="mt-2 text-sm leading-6 text-indigo-900">Перед первой заметкой, фотографией или документом подтвердите права на материалы. Запрещено размещать чужие персональные данные, документы и изображения людей без необходимых согласий.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a>, подтверждаю наличие необходимых прав и согласий и несу ответственность за загружаемые тексты, документы и изображения.</span></label><Button className="mt-4 bg-brand-solid" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <div className="space-y-6"><section className="border-b border-line pb-6"><div><h3 className="text-lg font-bold text-ink-strong">Домашнее задание</h3><p className="mt-1 text-sm text-ink-muted">Задание к следующему уроку и комментарий ученика.</p></div>
      {role !== "student" ? <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-assignment" className="font-bold">Задание ученику</Label><span className="text-xs text-ink-subtle">{homeworkAssignment.length}/4000</span></div><Textarea id="homework-assignment" value={homeworkAssignment} maxLength={4000} rows={4} onChange={(event) => setHomeworkAssignment(event.target.value)} placeholder="Что нужно подготовить или выполнить к следующему уроку" /><div className="mt-3 flex justify-end gap-2">{data.homework.assignment && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("assignment", "")}><Trash2 />Удалить</Button>}<Button className="bg-brand-solid" disabled={pending || homeworkAssignment.trim() === data.homework.assignment} onClick={() => void saveHomework("assignment", homeworkAssignment)}>Сохранить задание</Button></div></div> : <div className="mt-4 rounded-xl bg-surface p-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Задание преподавателя</p><p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-ink-body">{data.homework.assignment || "Преподаватель пока не добавил задание."}</p></div>}
      {role === "student" ? <div className="mt-4 border-t border-line pt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-response" className="font-bold">Мой ответ или комментарий</Label><span className="text-xs text-ink-subtle">{homeworkResponse.length}/4000</span></div><Textarea id="homework-response" value={homeworkResponse} maxLength={4000} rows={4} onChange={(event) => setHomeworkResponse(event.target.value)} placeholder="Напишите, что выполнено, или задайте вопрос по заданию" /><div className="mt-3 flex justify-end gap-2">{data.homework.studentResponse && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("student_response", "")}><Trash2 />Удалить</Button>}<Button className="bg-brand-solid" disabled={pending || homeworkResponse.trim() === data.homework.studentResponse} onClick={() => void saveHomework("student_response", homeworkResponse)}>Сохранить ответ</Button></div></div> : data.homework.responses ? data.homework.responses.length > 0 && <div className="mt-4 border-t border-line pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ответы участников</p>{data.homework.responses.map((response) => <div key={response.studentName} className="mt-3"><p data-no-translate className="text-sm font-semibold">{response.studentName}</p><p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-ink-body">{response.body}</p></div>)}</div> : data.homework.studentResponse && <div className="mt-4 border-t border-line pt-4"><p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Ответ ученика</p><p className="mt-2 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-ink-body">{data.homework.studentResponse}</p></div>}
    </section><section className="border-b border-line pb-6"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="shared-lesson-note" className="font-bold">{role === "student" ? "Моя заметка преподавателю" : "Общая заметка ученику"}</Label><span className="text-xs text-ink-subtle">{sharedNote.length}/4000</span></div><p className="mb-3 text-xs text-ink-muted">{role === "student" ? "Преподаватель увидит эту заметку." : "Ученик увидит эту заметку в своём кабинете."}</p><Textarea id="shared-lesson-note" value={sharedNote} maxLength={4000} rows={5} onChange={(event) => setSharedNote(event.target.value)} placeholder={role === "student" ? "Вопрос или комментарий к уроку" : "Рекомендация или комментарий к уроку"} /><div className="mt-3 flex justify-end gap-2">{sharedMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(sharedMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-brand-solid" disabled={pending || !sharedNote.trim() || sharedNote.trim() === sharedMine?.body} onClick={() => void saveNote("shared", sharedNote)}>Сохранить заметку</Button></div></section>
      {role !== "student" && <details className="rounded-2xl border border-line bg-surface-subtle"><summary className="cursor-pointer px-5 py-4 font-bold">Личная заметка преподавателя{privateNote && <span className="ml-2 text-xs font-normal text-ink-muted">· сохранена</span>}</summary><section className="border-t border-line p-5"><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs text-ink-muted">Ученик её не увидит.</p><span className="text-xs text-ink-subtle">{privateNote.length}/4000</span></div><Textarea id="private-lesson-note" value={privateNote} maxLength={4000} rows={4} onChange={(event) => setPrivateNote(event.target.value)} placeholder="Личные наблюдения по уроку" /><div className="mt-3 flex justify-end gap-2">{privateMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(privateMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-brand-solid" disabled={pending || !privateNote.trim() || privateNote.trim() === privateMine?.body} onClick={() => void saveNote("teacher_private", privateNote)}>Сохранить личную заметку</Button></div></section></details>}
      {otherNotes.length > 0 && <section><h3 className="mb-3 font-bold">{role === "student" ? "Заметка преподавателя" : "Заметка ученика"}</h3><div className="space-y-3">{otherNotes.map((note) => <article key={note.id} className="rounded-2xl border border-line p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{note.authorName}</p><p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6 text-ink-body">{note.body}</p></div>{note.canDelete && <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label="Удалить заметку" onClick={() => void removeNote(note.id)}><Trash2 className="size-4" /></Button>}</div></article>)}</div></section>}
      <section><div><h3 className="font-bold">Материалы из библиотеки</h3><p className="mt-1 text-sm text-ink-muted">PDF, Word и изображения, которыми преподаватель поделился для этого урока.</p></div>
        {role !== "student" && <div className="mt-4 flex flex-col gap-3 sm:flex-row"><SearchableSelect value={selectedResource} onValueChange={setSelectedResource} disabled={!availableResources.length} placeholder={availableResources.length ? "Найти материал в библиотеке" : "Нет непривязанных материалов"} searchPlaceholder="Поиск по названию, файлу, папке или тегу" emptyText="Подходящих материалов не найдено" items={availableResources.map((resource) => ({ value: resource.id, label: resource.title, description: `${resource.filename} · ${formatBytes(resource.byteSize)}`, searchText: [resource.folder ?? "", ...(resource.tags ?? [])].join(" ") }))} /><Button type="button" variant="outline" className="shrink-0" disabled={pending || !selectedResource} onClick={() => void changeResourceLink(selectedResource, true)}><Link2 />Добавить к уроку</Button></div>}
        {data.documents.length ? <div className="mt-4 divide-y overflow-hidden rounded-2xl border border-line">{data.documents.map((document) => <article key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">{isImageMaterial(document) ? <ImageIcon className="size-5 shrink-0 text-brand-text" /> : <FileText className="size-5 shrink-0 text-brand-text" />}<div className="min-w-0 flex-1"><strong className="block truncate">{document.title}</strong><p className="truncate text-xs text-ink-muted">{document.filename} · {formatBytes(document.byteSize)}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPreview({ title: document.title, filename: document.filename, contentType: document.contentType, url: `${document.url}?preview=1`, downloadUrl: document.url })}><Eye />Открыть</Button><Button asChild size="sm" variant="ghost"><a href={document.url} aria-label={`Скачать ${document.title}`}><Download /></a></Button>{role !== "student" && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void changeResourceLink(document.id, false)}><Unlink />Открепить</Button>}</div></article>)}</div> : <div className="mt-4 grid min-h-24 place-items-center rounded-2xl border border-dashed border-line text-center text-sm text-ink-muted"><span><FileText className="mx-auto mb-2 size-6 text-ink-faint" />Материалов из библиотеки пока нет</span></div>}
        {role !== "student" && data.library.length === 0 && <p className="mt-3 text-xs text-ink-muted">Сначала добавьте PDF, Word или изображение в раздел «Материалы» кабинета.</p>}
      </section>
      <section><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-bold">Фотографии</h3><p className="mt-1 text-sm text-ink-muted">До 5 фотографий от каждого участника. Файлы автоматически удаляются через 90 дней после урока.</p></div>{data.photoStorageConfigured && minePhotoCount < data.maxPhotosPerParticipant && <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 text-sm font-semibold text-white ${pending ? "pointer-events-none opacity-50" : ""}`}><Upload className="size-4" />Добавить<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={pending} onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>}</div>
        {!data.photoStorageConfigured && <p className="mt-3 rounded-xl bg-warning-soft p-4 text-sm text-warning-ink">Хранилище фотографий пока не настроено. Текстовые заметки работают независимо от него.</p>}
        {data.attachments.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{data.attachments.map((photo) => <figure key={photo.id} className="group relative overflow-hidden rounded-2xl border border-line bg-surface-subtle"><button type="button" className="block w-full" onClick={() => setPreview({ title: `Фотография от ${photo.authorName}`, contentType: "image/webp", url: photo.url, downloadUrl: `${photo.url}?download=1` })}><img src={photo.url} alt={`Фотография к уроку от ${photo.authorName}`} className="aspect-square w-full object-cover" /></button>{photo.canDelete && <Button type="button" size="icon" variant="destructive" disabled={pending} className="absolute right-2 top-2 size-8" aria-label="Удалить фотографию" onClick={() => void removePhoto(photo.id)}><Trash2 className="size-4" /></Button>}<figcaption className="p-2 text-xs text-ink-muted"><span className="block truncate">{photo.authorName}</span><span>до {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(photo.expiresAt))}</span></figcaption></figure>)}</div> : <div className="mt-4 grid min-h-28 place-items-center rounded-2xl border border-dashed border-line text-center text-sm text-ink-muted"><span><Camera className="mx-auto mb-2 size-6 text-ink-faint" />Фотографий пока нет</span></div>}
      </section></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogFooter>
  </DialogContent></Dialog><MaterialPreviewDialog item={preview} onOpenChange={(open) => !open && setPreview(null)} /></>;
}

