"use client";
/* eslint-disable @next/next/no-img-element -- protected lesson photos are already resized server-side and require the viewer's session cookie. */

import { useCallback, useEffect, useState } from "react";
import { Camera, Download, Eye, FileText, Link2, Trash2, Unlink, Upload } from "lucide-react";
import { toast } from "sonner";
import type { Lesson, LessonMaterialsData } from "@/components/features/app/types";
import { readLessonMaterials, saveLessonMaterial } from "@/components/features/materials/api";
import { formatBytes } from "@/components/features/materials/format";
import { MaterialPreviewDialog, type MaterialPreviewItem } from "@/components/features/materials/material-preview-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  return <><Dialog open={Boolean(lesson)} onOpenChange={onOpenChange}><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-3xl"><DialogHeader><DialogTitle className="text-2xl">Материалы урока</DialogTitle><DialogDescription>{lesson ? `${lesson.name} · ${dateTitle(lesson.date, { day: "numeric", month: "long", year: "numeric" })}, ${lesson.time}` : "Заметки, документы и фотографии"}</DialogDescription></DialogHeader>
    {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    {!data && !error && <p className="py-10 text-center text-slate-500">Загружаю материалы…</p>}
    {data && !data.contentRulesAccepted && <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5"><h3 className="font-bold text-indigo-950">Правила пользовательского контента</h3><p className="mt-2 text-sm leading-6 text-indigo-900">Перед первой заметкой, фотографией или документом подтвердите права на материалы. Запрещено размещать чужие персональные данные, документы и изображения людей без необходимых согласий.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a>, подтверждаю наличие необходимых прав и согласий и несу ответственность за загружаемые тексты, документы и изображения.</span></label><Button className="mt-4 bg-indigo-600" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <div className="space-y-6"><section className="rounded-2xl border border-indigo-200 bg-indigo-50/60 p-5"><div><h3 className="font-bold text-indigo-950">Домашнее задание</h3><p className="mt-1 text-sm text-indigo-800">Задание преподавателя и отдельный ответ ученика — без смешивания с заметками.</p></div>
      {role !== "student" ? <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-assignment" className="font-bold">Задание ученику</Label><span className="text-xs text-slate-400">{homeworkAssignment.length}/4000</span></div><Textarea id="homework-assignment" value={homeworkAssignment} maxLength={4000} rows={4} onChange={(event) => setHomeworkAssignment(event.target.value)} placeholder="Что нужно подготовить или выполнить к следующему уроку" /><div className="mt-3 flex justify-end gap-2">{data.homework.assignment && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("assignment", "")}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || homeworkAssignment.trim() === data.homework.assignment} onClick={() => void saveHomework("assignment", homeworkAssignment)}>Сохранить задание</Button></div></div> : <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Задание преподавателя</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{data.homework.assignment || "Преподаватель пока не добавил задание."}</p></div>}
      {role === "student" ? <div className="mt-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="homework-response" className="font-bold">Мой ответ или комментарий</Label><span className="text-xs text-slate-400">{homeworkResponse.length}/4000</span></div><Textarea id="homework-response" value={homeworkResponse} maxLength={4000} rows={4} onChange={(event) => setHomeworkResponse(event.target.value)} placeholder="Напишите, что выполнено, или задайте вопрос по заданию" /><div className="mt-3 flex justify-end gap-2">{data.homework.studentResponse && <Button variant="outline" disabled={pending} onClick={() => void saveHomework("student_response", "")}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || homeworkResponse.trim() === data.homework.studentResponse} onClick={() => void saveHomework("student_response", homeworkResponse)}>Сохранить ответ</Button></div></div> : <div className="mt-4 rounded-xl bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ответ ученика</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{data.homework.studentResponse || "Ученик пока не добавил ответ."}</p></div>}
    </section><section><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="shared-lesson-note" className="font-bold">{role === "student" ? "Моя заметка преподавателю" : "Общая заметка ученику"}</Label><span className="text-xs text-slate-400">{sharedNote.length}/4000</span></div><Textarea id="shared-lesson-note" value={sharedNote} maxLength={4000} rows={5} onChange={(event) => setSharedNote(event.target.value)} placeholder={role === "student" ? "Вопрос или комментарий к уроку" : "Рекомендация или комментарий к уроку"} /><div className="mt-3 flex justify-end gap-2">{sharedMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(sharedMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || !sharedNote.trim() || sharedNote.trim() === sharedMine?.body} onClick={() => void saveNote("shared", sharedNote)}>Сохранить заметку</Button></div></section>
      {role !== "student" && <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="mb-2 flex items-center justify-between gap-3"><Label htmlFor="private-lesson-note" className="font-bold">Личная заметка преподавателя</Label><span className="text-xs text-slate-400">{privateNote.length}/4000</span></div><p className="mb-3 text-xs text-slate-500">Ученик её не увидит.</p><Textarea id="private-lesson-note" value={privateNote} maxLength={4000} rows={4} onChange={(event) => setPrivateNote(event.target.value)} placeholder="Личные наблюдения по уроку" /><div className="mt-3 flex justify-end gap-2">{privateMine && <Button variant="outline" disabled={pending} onClick={() => void removeNote(privateMine.id)}><Trash2 />Удалить</Button>}<Button className="bg-indigo-600" disabled={pending || !privateNote.trim() || privateNote.trim() === privateMine?.body} onClick={() => void saveNote("teacher_private", privateNote)}>Сохранить личную заметку</Button></div></section>}
      {otherNotes.length > 0 && <section><h3 className="mb-3 font-bold">{role === "student" ? "Заметка преподавателя" : "Заметка ученика"}</h3><div className="space-y-3">{otherNotes.map((note) => <article key={note.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{note.authorName}</p><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{note.body}</p></div>{note.canDelete && <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label="Удалить заметку" onClick={() => void removeNote(note.id)}><Trash2 className="size-4" /></Button>}</div></article>)}</div></section>}
      <section><div><h3 className="font-bold">Документы</h3><p className="mt-1 text-sm text-slate-500">PDF и Word, которыми преподаватель поделился для этого урока.</p></div>
        {role !== "student" && <div className="mt-4 flex flex-col gap-3 sm:flex-row"><Select value={selectedResource} onValueChange={setSelectedResource}><SelectTrigger className="min-w-0 flex-1"><SelectValue placeholder={availableResources.length ? "Выберите документ из библиотеки" : "Нет непривязанных документов"} /></SelectTrigger><SelectContent>{availableResources.map((resource) => <SelectItem key={resource.id} value={resource.id}>{resource.title} · {formatBytes(resource.byteSize)}</SelectItem>)}</SelectContent></Select><Button type="button" variant="outline" disabled={pending || !selectedResource} onClick={() => void changeResourceLink(selectedResource, true)}><Link2 />Добавить к уроку</Button></div>}
        {data.documents.length ? <div className="mt-4 divide-y overflow-hidden rounded-2xl border border-slate-200">{data.documents.map((document) => <article key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><FileText className="size-5 shrink-0 text-indigo-600" /><div className="min-w-0 flex-1"><strong className="block truncate">{document.title}</strong><p className="truncate text-xs text-slate-500">{document.filename} · {formatBytes(document.byteSize)}</p></div><div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setPreview({ title: document.title, filename: document.filename, contentType: document.contentType, url: document.url })}><Eye />Открыть</Button><Button asChild size="sm" variant="ghost"><a href={document.url} aria-label={`Скачать ${document.title}`}><Download /></a></Button>{role !== "student" && <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void changeResourceLink(document.id, false)}><Unlink />Открепить</Button>}</div></article>)}</div> : <div className="mt-4 grid min-h-24 place-items-center rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500"><span><FileText className="mx-auto mb-2 size-6 text-slate-300" />Документов для урока пока нет</span></div>}
        {role !== "student" && data.library.length === 0 && <p className="mt-3 text-xs text-slate-500">Сначала добавьте PDF или Word в раздел «Материалы» кабинета.</p>}
      </section>
      <section><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-bold">Фотографии</h3><p className="mt-1 text-sm text-slate-500">До 5 фотографий от каждого участника. Файлы автоматически удаляются через 90 дней после урока.</p></div>{data.photoStorageConfigured && minePhotoCount < data.maxPhotosPerParticipant && <label className={`inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white ${pending ? "pointer-events-none opacity-50" : ""}`}><Upload className="size-4" />Добавить<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" disabled={pending} onChange={(event) => { void uploadPhotos(event.target.files); event.currentTarget.value = ""; }} /></label>}</div>
        {!data.photoStorageConfigured && <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Хранилище фотографий пока не настроено. Текстовые заметки работают независимо от него.</p>}
        {data.attachments.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">{data.attachments.map((photo) => <figure key={photo.id} className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"><button type="button" className="block w-full" onClick={() => setPreview({ title: `Фотография от ${photo.authorName}`, contentType: "image/webp", url: photo.url, downloadUrl: `${photo.url}?download=1` })}><img src={photo.url} alt={`Фотография к уроку от ${photo.authorName}`} className="aspect-square w-full object-cover" /></button>{photo.canDelete && <Button type="button" size="icon" variant="destructive" disabled={pending} className="absolute right-2 top-2 size-8" aria-label="Удалить фотографию" onClick={() => void removePhoto(photo.id)}><Trash2 className="size-4" /></Button>}<figcaption className="p-2 text-xs text-slate-500"><span className="block truncate">{photo.authorName}</span><span>до {new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric" }).format(new Date(photo.expiresAt))}</span></figcaption></figure>)}</div> : <div className="mt-4 grid min-h-28 place-items-center rounded-2xl border border-dashed border-slate-200 text-center text-sm text-slate-500"><span><Camera className="mx-auto mb-2 size-6 text-slate-300" />Фотографий пока нет</span></div>}
      </section></div>}
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button></DialogFooter>
  </DialogContent></Dialog><MaterialPreviewDialog item={preview} onOpenChange={(open) => !open && setPreview(null)} /></>;
}

