"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, Eye, FileText, Image as ImageIcon, Pencil, RefreshCw, Search, Tag, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/common/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { FormField } from "@/components/common/form-field";
import type { TeacherMaterial, TeacherMaterialsData } from "@/components/features/app/types";
import { readTeacherMaterials, saveLessonMaterial, updateStudentMaterialShare } from "@/components/features/materials/api";
import { formatBytes, isImageMaterial, isPdfMaterial, isWordMaterial, materialTags, materialTypeLabel } from "@/components/features/materials/format";
import { MaterialPreviewDialog, type MaterialPreviewItem } from "@/components/features/materials/material-preview-dialog";
import { ShareMaterialDialog } from "@/components/features/materials/share-material-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { appFetch } from "@/lib/client-fetch";
import { russianPlural } from "@/lib/russian-plural";

export function TeacherMaterialsView() {
  const [data, setData] = useState<TeacherMaterialsData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [folder, setFolder] = useState("");
  const [tags, setTags] = useState("");
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "pdf" | "word" | "image">("all");
  const [folderFilter, setFolderFilter] = useState("all");
  const [sort, setSort] = useState<"recent" | "new" | "title">("recent");
  const [acceptedRules, setAcceptedRules] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<MaterialPreviewItem | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [expandedResourceId, setExpandedResourceId] = useState<string | null>(null);
  const load = useCallback(async () => setData(await readTeacherMaterials()), []);

  useEffect(() => {
    let active = true;
    void readTeacherMaterials().then((next) => active && setData(next)).catch((reason) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить библиотеку"));
    return () => { active = false; };
  }, []);

  const folders = useMemo(() => [...new Set((data?.resources ?? []).map((resource) => resource.folder).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "ru")), [data]);
  const filteredResources = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru-RU");
    return [...(data?.resources ?? [])].filter((resource) => {
      const matchesType = typeFilter === "all" || typeFilter === "pdf" && isPdfMaterial(resource) || typeFilter === "word" && isWordMaterial(resource) || typeFilter === "image" && isImageMaterial(resource);
      const matchesFolder = folderFilter === "all" || folderFilter === "none" && !resource.folder || resource.folder === folderFilter;
      const haystack = [resource.title, resource.filename, resource.folder ?? "", ...(resource.tags ?? []), ...(resource.assignments ?? []).map((item) => item.studentName), ...(resource.sharedStudents ?? []).map((item) => item.studentName)].join(" ").toLocaleLowerCase("ru-RU");
      return matchesType && matchesFolder && (!needle || haystack.includes(needle));
    }).sort((a, b) => sort === "title" ? a.title.localeCompare(b.title, "ru") : sort === "new" ? b.createdAt - a.createdAt : (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
  }, [data, folderFilter, query, sort, typeFilter]);

  const acceptRules = async () => {
    if (!acceptedRules) return;
    setPending(true); setError("");
    try { await saveLessonMaterial({ action: "acceptContentRules", accepted: true }); await load(); toast.success("Правила приняты"); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить согласие"); }
    finally { setPending(false); }
  };

  const upload = async () => {
    if (!file || !data) return;
    if (file.size > data.maxFileBytes) { setError("Файл должен быть не больше 25 МБ"); return; }
    setPending(true); setError("");
    try {
      const form = new FormData(); form.set("file", file); form.set("title", title.trim()); form.set("folder", folder.trim()); form.set("tags", JSON.stringify(materialTags(tags)));
      const response = await appFetch("/api/teacher-materials", { method: "POST", body: form });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить материал");
      setFile(null); setTitle(""); setFolder(""); setTags(""); await load(); toast.success("Материал добавлен в библиотеку");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить материал"); }
    finally { setPending(false); }
  };

  const saveMetadata = async (resource: TeacherMaterial, next: { title: string; folder: string; tags: string[] }) => {
    setPending(true); setError("");
    try {
      const response = await appFetch("/api/teacher-materials", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: resource.id, title: next.title, folder: next.folder.trim() || null, tags: next.tags }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось обновить материал");
      await load(); toast.success("Название, папка и теги сохранены"); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось обновить материал"); return false; }
    finally { setPending(false); }
  };

  const replaceFile = async (resource: TeacherMaterial, replacement: File) => {
    if (!data || replacement.size > data.maxFileBytes) { setError("Файл должен быть не больше 25 МБ"); return false; }
    setPending(true); setError("");
    try {
      const form = new FormData(); form.set("file", replacement);
      const response = await appFetch(`/api/teacher-materials?id=${encodeURIComponent(resource.id)}`, { method: "PUT", body: form });
      const result = await response.json() as { error?: string; versionNumber?: number };
      if (!response.ok) throw new Error(result.error ?? "Не удалось заменить файл");
      await load(); toast.success(`Новая версия ${result.versionNumber ?? ""} сохранена, назначения не изменились`); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось заменить файл"); return false; }
    finally { setPending(false); }
  };

  const remove = async (resource: TeacherMaterial) => {
    if (!window.confirm(`Удалить «${resource.title}» из библиотеки и всех уроков?`)) return;
    setPending(true); setError("");
    try {
      const response = await appFetch(`/api/teacher-materials?id=${encodeURIComponent(resource.id)}`, { method: "DELETE" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось удалить материал");
      await load(); toast.success("Материал удалён");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось удалить материал"); }
    finally { setPending(false); }
  };

  const changeStudentShare = async (resource: TeacherMaterial, studentId: string, action: "share" | "unshare") => {
    setPending(true); setError("");
    try {
      await updateStudentMaterialShare(resource.id, studentId, action);
      await load();
      toast.success(action === "share" ? "Материал отправлен ученику" : "Доступ ученика закрыт");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить доступ к материалу");
      return false;
    } finally { setPending(false); }
  };

  return <AppShell title="Материалы" eyebrow="Библиотека преподавателя"><div className="space-y-6">
    {error && <p className="max-w-5xl rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
    {!data && !error && <div className="card max-w-5xl p-8 text-center text-slate-500">Загружаю библиотеку…</div>}
    {data && !data.contentRulesAccepted && <section className="card max-w-3xl border-indigo-200 bg-indigo-50 p-6"><h2 className="text-xl font-bold text-indigo-950">Правила пользовательского контента</h2><p className="mt-2 text-sm leading-6 text-indigo-900">Перед загрузкой файлов подтвердите, что у вас есть права на их хранение и передачу ученикам.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a> и несу ответственность за загружаемые материалы.</span></label><Button className="mt-4 bg-indigo-600" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <>
      <datalist id="teacher-material-folders">{folders.map((item) => <option value={item} key={item} />)}</datalist>
      <section className="card max-w-5xl overflow-hidden"><button type="button" className="flex w-full items-center gap-4 p-5 text-left hover:bg-slate-50 md:p-7" aria-expanded={uploadOpen} onClick={() => setUploadOpen((current) => !current)}><span className="min-w-0 flex-1"><span className="block text-xl font-bold">Добавить материал</span><span className="mt-1 block text-sm text-slate-500">{data.uploadsThisMonth} из {data.maxUploadsPerMonth} загрузок · {formatBytes(data.storageBytes)} из {formatBytes(data.maxStorageBytes)}</span></span><ChevronDown className={`size-5 shrink-0 text-slate-400 transition-transform ${uploadOpen ? "rotate-180" : ""}`} /></button>
        {uploadOpen && <div className="border-t border-slate-200 p-5 md:p-7"><p className="max-w-2xl text-sm leading-6 text-slate-500">PDF, DOC, DOCX, JPEG, PNG или WebP до 25 МБ. Изображения автоматически уменьшаются до 2000 пикселей и сохраняются в WebP.</p>{!data.storageConfigured && <p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-800">S3-хранилище материалов пока не настроено.</p>}{data.storageConfigured && <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-[1.1fr_1fr_1fr_1.2fr_auto] xl:items-end"><FormField label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Упражнения на координацию" /></FormField><FormField label="Папка"><Input list="teacher-material-folders" value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} placeholder="Например: Начинающие" /></FormField><FormField label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="ритм, техника" /></FormField><FormField label="Файл"><Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !title) setTitle(next.name.replace(/\.(pdf|docx?|jpe?g|png|webp)$/i, "")); }} /></FormField><Button className="bg-indigo-600 md:col-span-2 xl:col-span-1" disabled={pending || !file || !title.trim() || data.uploadsThisMonth >= data.maxUploadsPerMonth} onClick={() => void upload()}><Upload />{pending ? "Загружаю…" : "Добавить"}</Button></div>}</div>}
      </section>
      <section className="card max-w-5xl overflow-hidden"><div className="border-b border-slate-200 p-5 md:px-7"><div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold">Моя библиотека</h2><p className="mt-1 text-sm text-slate-500">Поиск работает по названию, файлу, папкам, тегам и ученикам.</p></div><p className="text-sm font-medium text-slate-500">Показано {filteredResources.length} из {data.resources.length}</p></div><div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1.4fr)_minmax(180px,220px)_minmax(160px,1fr)_minmax(210px,1.2fr)]"><label className="relative min-w-0"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти материал или ученика" className="min-w-0 pl-9" /></label><Select value={typeFilter} onValueChange={(value) => setTypeFilter(value as typeof typeFilter)}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все форматы</SelectItem><SelectItem value="pdf">Только PDF</SelectItem><SelectItem value="word">Только Word</SelectItem><SelectItem value="image">Только изображения</SelectItem></SelectContent></Select><Select value={folderFilter} onValueChange={setFolderFilter}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все папки</SelectItem><SelectItem value="none">Без папки</SelectItem>{folders.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}><SelectTrigger className="w-full min-w-0"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Недавно использованные</SelectItem><SelectItem value="new">Сначала новые</SelectItem><SelectItem value="title">По названию</SelectItem></SelectContent></Select></div></div>
        {filteredResources.length ? <div className="divide-y divide-slate-200">{filteredResources.map((resource) => <article key={resource.id} className="p-5 md:px-7"><div className="flex gap-3 md:items-start"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-indigo-50 text-indigo-600">{isImageMaterial(resource) ? <ImageIcon className="size-5" /> : <FileText className="size-5" />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="min-w-0 truncate">{resource.title}</strong><span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">{materialTypeLabel(resource)}</span></div><p className="mt-1 truncate text-sm text-slate-500">{resource.filename} · {formatBytes(resource.byteSize)}{resource.folder ? ` · ${resource.folder}` : ""}</p></div></div><div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => setPreview({ title: resource.title, filename: resource.filename, contentType: resource.contentType, url: `${resource.url}?preview=1`, downloadUrl: resource.url })}><Eye />Открыть</Button><Button size="sm" variant="ghost" className="ml-auto" aria-expanded={expandedResourceId === resource.id} onClick={() => setExpandedResourceId((current) => current === resource.id ? null : resource.id)}>Ещё<ChevronDown className={`transition-transform ${expandedResourceId === resource.id ? "rotate-180" : ""}`} /></Button></div>
          {expandedResourceId === resource.id && <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="ghost"><a href={resource.url} aria-label={`Скачать ${resource.title}`}><Download />Скачать</a></Button><ShareMaterialDialog resource={resource} students={data.students} pending={pending} onShare={(item, studentId) => changeStudentShare(item, studentId, "share")} onUnshare={(item, studentId) => changeStudentShare(item, studentId, "unshare")} /><ManageTeacherMaterialDialog resource={resource} folders={folders} maxFileBytes={data.maxFileBytes} uploadLimitReached={data.uploadsThisMonth >= data.maxUploadsPerMonth} pending={pending} onSave={saveMetadata} onReplace={replaceFile} /><Button size="sm" variant="outline" className="text-rose-600" disabled={pending} onClick={() => void remove(resource)}><Trash2 />Удалить</Button></div>{Boolean(resource.tags?.length) && <div className="mt-3 flex flex-wrap gap-1.5">{resource.tags?.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-1 text-xs font-medium text-violet-700"><Tag className="size-3" />{tag}</span>)}</div>}<p className="mt-3 text-xs text-slate-500">{resource.lastUsedAt ? `Недавно использован ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(resource.lastUsedAt)}` : "Ещё не использовался"} · версия {resource.versionNumber ?? 1}</p><details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-slate-700">Назначен: {russianPlural(resource.assignments?.length ?? 0, "уроку", "урокам", "урокам")}</summary><div className="pt-3">{resource.assignments?.length ? <ul className="space-y-2">{resource.assignments.map((assignment) => <li key={`${assignment.lessonId}-${assignment.startsAt}`} className="flex flex-col justify-between gap-1 text-sm sm:flex-row"><span className="font-medium">{assignment.studentName}</span><span className="text-slate-500">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(assignment.startsAt)}</span></li>)}</ul> : <p className="text-sm text-slate-500">Материал пока не назначен ни одному уроку.</p>}</div></details></div>}
        </article>)}</div> : <EmptyState text={data.resources.length ? "По выбранным условиям ничего не найдено" : "В библиотеке пока нет материалов"} />}
      </section>
    </>}
  </div><MaterialPreviewDialog item={preview} onOpenChange={(open) => !open && setPreview(null)} /></AppShell>;
}

function ManageTeacherMaterialDialog({ resource, folders, maxFileBytes, uploadLimitReached, pending, onSave, onReplace }: { resource: TeacherMaterial; folders: string[]; maxFileBytes: number; uploadLimitReached: boolean; pending: boolean; onSave: (resource: TeacherMaterial, next: { title: string; folder: string; tags: string[] }) => Promise<boolean>; onReplace: (resource: TeacherMaterial, file: File) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(resource.title);
  const [folder, setFolder] = useState(resource.folder ?? "");
  const [tags, setTags] = useState((resource.tags ?? []).join(", "));
  const [replacement, setReplacement] = useState<File | null>(null);
  const save = async () => { if (await onSave(resource, { title: title.trim(), folder, tags: materialTags(tags) })) setOpen(false); };
  const replace = async () => { if (!replacement || replacement.size > maxFileBytes) return; if (await onReplace(resource, replacement)) { setReplacement(null); setOpen(false); } };
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Pencil />Настроить</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-xl"><DialogHeader><DialogTitle>Настроить материал</DialogTitle><DialogDescription>Измените метаданные или загрузите новую версию. Связи с уроками сохранятся.</DialogDescription></DialogHeader><div className="space-y-5"><FormField label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></FormField><FormField label="Папка"><Input list="teacher-material-folders" value={folder} maxLength={80} onChange={(event) => setFolder(event.target.value)} placeholder="Без папки" />{folders.length > 0 && <p className="text-xs text-slate-500">Можно выбрать существующую папку или написать новую.</p>}</FormField><FormField label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="через, запятую" /><p className="text-xs text-slate-500">До 10 тегов, каждый не длиннее 30 символов.</p></FormField><Button className="w-full bg-indigo-600" disabled={pending || !title.trim() || materialTags(tags).some((tag) => tag.length > 30)} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить название, папку и теги"}</Button><div className="border-t border-slate-200 pt-5"><h3 className="font-bold">Заменить файл</h3><p className="mt-1 text-sm leading-6 text-slate-500">Новая версия заменит текущий файл. Все назначения ученикам и урокам останутся на месте.</p><Input className="mt-4" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" disabled={pending || uploadLimitReached} onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />{uploadLimitReached && <p className="mt-2 text-xs font-medium text-amber-700">Месячный лимит загрузок исчерпан.</p>}<Button variant="outline" className="mt-3 w-full" disabled={pending || uploadLimitReached || !replacement || replacement.size > maxFileBytes} onClick={() => void replace()}><RefreshCw />{pending ? "Заменяю…" : `Загрузить версию ${(resource.versionNumber ?? 1) + 1}`}</Button></div></div></DialogContent></Dialog>;
}
