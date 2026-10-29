"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Tag, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/common/app-shell";
import { EmptyState } from "@/components/common/empty-state";
import { FilterChips } from "@/components/common/filter-chips";
import { FormField } from "@/components/common/form-field";
import type { TeacherMaterial, TeacherMaterialsData } from "@/components/features/app/types";
import { readTeacherMaterials, saveLessonMaterial, updateStudentMaterialShare } from "@/components/features/materials/api";
import { formatBytes, isImageMaterial, isPdfMaterial, isWordMaterial, materialTags } from "@/components/features/materials/format";
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

  const uploadFields = data ? <><p className="max-w-2xl text-sm leading-6 text-ink-muted">PDF, DOC, DOCX, JPEG, PNG или WebP до 25 МБ, аудио MP3 до 20 МБ. Изображения автоматически уменьшаются до 2000 пикселей и сохраняются в WebP.</p>{!data.storageConfigured && <p className="mt-5 rounded-xl bg-warning-soft p-4 text-sm text-warning-ink">S3-хранилище материалов пока не настроено.</p>}{data.storageConfigured && <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:items-end xl:grid-cols-[1.1fr_1.3fr_0.9fr_1.3fr]"><FormField label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} placeholder="Упражнения на координацию" /></FormField><FormField label="Папка"><FolderInput value={folder} onChange={setFolder} placeholder="Например: Начинающие" /></FormField><FormField label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="ритм, техника" /></FormField><FormField label="Файл"><Input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.mp3,audio/mpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" disabled={pending} onChange={(event) => { const next = event.target.files?.[0] ?? null; setFile(next); if (next && !title) setTitle(next.name.replace(/\.(pdf|docx?|jpe?g|png|webp)$/i, "")); }} /></FormField><Button className="bg-brand-solid sm:col-span-2 xl:col-span-4 xl:justify-self-end xl:px-6" disabled={pending || !file || !title.trim() || data.uploadsThisMonth >= data.maxUploadsPerMonth} onClick={() => void upload()}><Upload />{pending ? "Загружаю…" : "Добавить"}</Button></div>}</> : null;

  const resourceDetails = (resource: TeacherMaterial) => data && <div className="mt-4 rounded-xl border border-line bg-surface-subtle p-4"><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="ghost"><a href={resource.url} aria-label={`Скачать ${resource.title}`}><Download />Скачать</a></Button><ShareMaterialDialog resource={resource} students={data.students} pending={pending} onShare={(item, studentId) => changeStudentShare(item, studentId, "share")} onUnshare={(item, studentId) => changeStudentShare(item, studentId, "unshare")} /><ManageTeacherMaterialDialog resource={resource} folders={folders} maxFileBytes={data.maxFileBytes} uploadLimitReached={data.uploadsThisMonth >= data.maxUploadsPerMonth} pending={pending} onSave={saveMetadata} onReplace={replaceFile} /><Button size="sm" variant="outline" className="text-danger-text" disabled={pending} onClick={() => void remove(resource)}><Trash2 />Удалить</Button></div>{Boolean(resource.tags?.length) && <div className="mt-3 flex flex-wrap gap-1.5">{resource.tags?.map((tag) => <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-status-trial px-2 py-1 text-xs font-medium text-status-trial-ink"><Tag className="size-3" />{tag}</span>)}</div>}<p className="mt-3 text-xs text-ink-muted">{resource.lastUsedAt ? `Недавно использован ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Moscow" }).format(resource.lastUsedAt)}` : "Ещё не использовался"} · версия {resource.versionNumber ?? 1}</p><details className="mt-3"><summary className="cursor-pointer text-sm font-semibold text-ink-body">Назначен: {russianPlural(resource.assignments?.length ?? 0, "уроку", "урокам", "урокам")}</summary><div className="pt-3">{resource.assignments?.length ? <ul className="space-y-2">{resource.assignments.map((assignment) => <li key={`${assignment.lessonId}-${assignment.startsAt}`} className="flex flex-col justify-between gap-1 text-sm sm:flex-row"><span className="font-medium">{assignment.studentName}</span><span className="text-ink-muted">{new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" }).format(assignment.startsAt)}</span></li>)}</ul> : <p className="text-sm text-ink-muted">Материал пока не назначен ни одному уроку.</p>}</div></details></div>;

  const openPreview = (resource: TeacherMaterial) => setPreview({ title: resource.title, filename: resource.filename, contentType: resource.contentType, url: `${resource.url}?preview=1`, downloadUrl: resource.url });
  const typeChips = [["all", "Все"], ["pdf", "PDF"], ["word", "Word"], ["image", "Изображения"]] as const;
  const resourceMeta = (resource: TeacherMaterial) => {
    const lessons = resource.assignments?.length ?? resource.lessonCount ?? 0;
    return [formatBytes(resource.byteSize), resource.folder, lessons ? russianPlural(lessons, "урок", "урока", "уроков") : "не назначен"].filter(Boolean).join(" · ");
  };
  const typeIcon = (resource: TeacherMaterial) => isImageMaterial(resource) ? { label: "IMG", className: "bg-success-soft text-success-ink" } : isPdfMaterial(resource) ? { label: "PDF", className: "bg-danger-soft text-danger-ink" } : { label: "DOC", className: "bg-status-request text-status-request-ink" };
  const pillTrigger = "h-9 w-auto min-w-0 gap-1.5 rounded-xl px-3 text-sm font-semibold";
  return <AppShell title="Материалы" eyebrow={data ? `Библиотека · ${data.uploadsThisMonth} из ${data.maxUploadsPerMonth} загрузок` : "Библиотека преподавателя"} actionsInline headerClassName="max-w-5xl" actions={data?.contentRulesAccepted ? <Button size="icon" className="size-11 shrink-0 rounded-xl" aria-label={uploadOpen ? "Закрыть добавление" : "Добавить материал"} aria-expanded={uploadOpen} onClick={() => setUploadOpen((current) => !current)}>{uploadOpen ? <X className="size-5" /> : <Plus className="size-6" />}</Button> : undefined}><div className="flex max-w-5xl flex-col gap-3">
    {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</p>}
    {!data && !error && <div className="rounded-2xl border border-line bg-surface p-8 text-center text-ink-muted">Загружаю библиотеку…</div>}
    {data && !data.contentRulesAccepted && <section className="rounded-2xl border border-brand-line bg-brand-soft p-5"><h2 className="text-lg font-bold">Правила пользовательского контента</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">Перед загрузкой файлов подтвердите, что у вас есть права на их хранение и передачу ученикам.</p><label className="mt-4 flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedRules} onCheckedChange={(value) => setAcceptedRules(value === true)} className="mt-0.5" /><span>Я принимаю <a href="/legal/content-rules" target="_blank" rel="noreferrer" className="underline">Правила размещения контента</a> и несу ответственность за загружаемые материалы.</span></label><Button className="mt-4" disabled={!acceptedRules || pending} onClick={() => void acceptRules()}>{pending ? "Сохраняю…" : "Принять правила"}</Button></section>}
    {data?.contentRulesAccepted && <>
      <datalist id="teacher-material-folders">{folders.map((item) => <option value={item} key={item} />)}</datalist>
      {uploadOpen && <section className="rounded-2xl border border-line bg-surface p-4 md:p-5"><div className="mb-3 flex items-baseline justify-between gap-3"><h2 className="text-lg font-bold">Добавить материал</h2><span className="text-xs text-ink-muted">{formatBytes(data.storageBytes)} из {formatBytes(data.maxStorageBytes)}</span></div>{uploadFields}</section>}
      <label className="relative"><Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти материал или ученика" className="h-11 rounded-xl bg-surface pl-10" /></label>
      <FilterChips label="Формат" items={typeChips.map(([value, label]) => ({ value, label }))} value={typeFilter} onChange={setTypeFilter} />
      <div className="flex flex-wrap items-center gap-2">
        <Select value={folderFilter} onValueChange={setFolderFilter}><SelectTrigger size="sm" aria-label="Папка" className={pillTrigger}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все папки</SelectItem><SelectItem value="none">Без папки</SelectItem>{folders.map((item) => <SelectItem value={item} key={item}>{item}</SelectItem>)}</SelectContent></Select>
        <Select value={sort} onValueChange={(value) => setSort(value as typeof sort)}><SelectTrigger size="sm" aria-label="Сортировка" className={pillTrigger}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="recent">Недавние</SelectItem><SelectItem value="new">Сначала новые</SelectItem><SelectItem value="title">По названию</SelectItem></SelectContent></Select>
        <span className="ml-auto text-sm text-ink-muted">{filteredResources.length === data.resources.length ? russianPlural(data.resources.length, "файл", "файла", "файлов") : `${filteredResources.length} из ${data.resources.length}`}</span>
      </div>
      {filteredResources.length ? <div className="overflow-hidden rounded-2xl border border-line bg-surface">{filteredResources.map((resource, index) => { const icon = typeIcon(resource); const expanded = expandedResourceId === resource.id; return <article key={resource.id} className={index < filteredResources.length - 1 ? "border-b border-line" : ""}>
        <div className="flex items-center gap-2.5 py-3 pl-3.5 pr-2.5">
          <span aria-hidden className={`grid size-10 shrink-0 place-items-center rounded-xl text-[11px] font-extrabold ${icon.className}`}>{icon.label}</span>
          <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" title={resource.title} aria-label={`Открыть ${resource.title}`} onClick={() => openPreview(resource)}><strong className="w-full truncate text-[15px]">{resource.title}</strong><span className="w-full truncate text-xs text-ink-muted">{resourceMeta(resource)}</span></button>
          <Button size="sm" variant="outline" className="hidden sm:inline-flex" onClick={() => openPreview(resource)}>Открыть</Button>
          <Button size="icon" variant="ghost" className="size-9 shrink-0 text-ink-muted" aria-label={`Ещё: ${resource.title}`} aria-expanded={expanded} onClick={() => setExpandedResourceId((current) => current === resource.id ? null : resource.id)}><MoreHorizontal className="size-5" /></Button>
        </div>
        {expanded && <div className="px-3.5 pb-3.5">{resourceDetails(resource)}</div>}
      </article>; })}</div> : <EmptyState text={data.resources.length ? "По выбранным условиям ничего не найдено" : "В библиотеке пока нет материалов"} />}
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
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm" variant="outline"><Pencil />Настроить</Button></DialogTrigger><DialogContent className="max-h-[92vh] overflow-y-auto rounded-3xl sm:max-w-xl"><DialogHeader><DialogTitle>Настроить материал</DialogTitle><DialogDescription>Измените метаданные или загрузите новую версию. Связи с уроками сохранятся.</DialogDescription></DialogHeader><div className="space-y-5"><FormField label="Название"><Input value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} /></FormField><FormField label="Папка"><FolderInput value={folder} onChange={setFolder} placeholder="Без папки" />{folders.length > 0 && <p className="text-xs text-ink-muted">Можно выбрать существующую папку или написать новую.</p>}</FormField><FormField label="Теги"><Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="через, запятую" /><p className="text-xs text-ink-muted">До 10 тегов, каждый не длиннее 30 символов.</p></FormField><Button className="w-full bg-brand-solid" disabled={pending || !title.trim() || materialTags(tags).some((tag) => tag.length > 30)} onClick={() => void save()}>{pending ? "Сохраняю…" : "Сохранить название, папку и теги"}</Button><div className="border-t border-line pt-5"><h3 className="font-bold">Заменить файл</h3><p className="mt-1 text-sm leading-6 text-ink-muted">Новая версия заменит текущий файл. Все назначения ученикам и урокам останутся на месте.</p><Input className="mt-4" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,.mp3,audio/mpeg,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp" disabled={pending || uploadLimitReached} onChange={(event) => setReplacement(event.target.files?.[0] ?? null)} />{uploadLimitReached && <p className="mt-2 text-xs font-medium text-warning-ink">Месячный лимит загрузок исчерпан.</p>}<Button variant="outline" className="mt-3 w-full" disabled={pending || uploadLimitReached || !replacement || replacement.size > maxFileBytes} onClick={() => void replace()}><RefreshCw />{pending ? "Заменяю…" : `Загрузить версию ${(resource.versionNumber ?? 1) + 1}`}</Button></div></div></DialogContent></Dialog>;
}

// Folder field with suggestions from existing folders; the arrow stays visible so it reads as a list.
function FolderInput({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <div className="relative">
    <Input className="pr-9 [&::-webkit-calendar-picker-indicator]:opacity-0" list="teacher-material-folders" value={value} maxLength={80} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
  </div>;
}
