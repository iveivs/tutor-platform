"use client";
/* eslint-disable @next/next/no-img-element -- protected thumbnails require the signed-in user's session cookie. */

import { useCallback, useEffect, useState } from "react";
import { Download, Eye, FileText, Images } from "lucide-react";
import { AppCard, AppCardDescription, AppCardTitle } from "@/components/common/app-card";
import { ShowMoreButton } from "@/components/common/show-more-button";
import type { StudentMaterialsData } from "@/components/features/app/types";
import { readStudentMaterials } from "@/components/features/materials/api";
import { formatBytes } from "@/components/features/materials/format";
import { MaterialPreviewDialog, type MaterialPreviewItem } from "@/components/features/materials/material-preview-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVisiblePolling } from "@/hooks/use-visible-polling";

const EMPTY_DATA: StudentMaterialsData = { documents: [], photos: [] };

export function StudentMaterialsCard({ embedded = false }: { embedded?: boolean }) {
  const [data, setData] = useState<StudentMaterialsData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [documentsExpanded, setDocumentsExpanded] = useState(false);
  const [photosExpanded, setPhotosExpanded] = useState(false);
  const [preview, setPreview] = useState<MaterialPreviewItem | null>(null);
  const load = useCallback(async () => {
    const result = await readStudentMaterials();
    setData(result);
    setError("");
  }, []);

  useEffect(() => {
    let active = true;
    void readStudentMaterials().then((result) => { if (active) setData(result); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "Не удалось загрузить материалы"); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  useVisiblePolling(async () => { await load().catch(() => undefined); }, !loading);

  const documents = data.documents.filter((material) => !material.contentType.startsWith("image/"));
  const photos = [...data.documents.filter((material) => material.contentType.startsWith("image/")), ...data.photos];
  const visibleDocuments = documentsExpanded ? documents : documents.slice(0, 3);
  const visiblePhotos = photosExpanded ? photos : photos.slice(0, 3);
  const content = <><AppCardTitle>{embedded ? "Файлы уроков" : "Материалы"}</AppCardTitle><AppCardDescription>Все документы и фотографии, которыми преподаватель поделился на уроках.</AppCardDescription>
    {loading ? <p className="mt-5 text-sm text-slate-500">Загружаю материалы…</p> : error ? <p className="mt-5 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : <Tabs defaultValue="documents" className="mt-5"><TabsList className="grid w-full grid-cols-2"><TabsTrigger value="documents"><FileText />Документы ({documents.length})</TabsTrigger><TabsTrigger value="photos"><Images />Изображения ({photos.length})</TabsTrigger></TabsList>
      <TabsContent value="documents" className="mt-3"><div className="divide-y overflow-hidden rounded-2xl border">{visibleDocuments.map((document) => <article key={document.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"><FileText className="size-5 shrink-0 text-indigo-500" /><div className="min-w-0 flex-1"><strong className="block truncate">{document.title}</strong><p className="truncate text-xs text-slate-500">{document.filename} · {formatBytes(document.byteSize)}</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setPreview({ title: document.title, filename: document.filename, contentType: document.contentType, url: `${document.url}?preview=1`, downloadUrl: document.url })}><Eye />Открыть</Button><Button asChild size="sm" variant="ghost"><a href={document.url} aria-label={`Скачать ${document.title}`}><Download /></a></Button></div></article>)}{documents.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Преподаватель пока не добавил документов.</p>}</div>{documents.length > 3 && <ShowMoreButton expanded={documentsExpanded} remaining={documents.length - 3} className="mt-3" onToggle={() => setDocumentsExpanded((value) => !value)} />}</TabsContent>
      <TabsContent value="photos" className="mt-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{visiblePhotos.map((photo) => { const libraryImage = "contentType" in photo; const title = libraryImage ? photo.title : `Фотография от ${photo.authorName}`; const previewUrl = libraryImage ? `${photo.url}?preview=1` : photo.url; const downloadUrl = libraryImage ? photo.url : `${photo.url}?download=1`; return <button key={`${libraryImage ? "library" : "lesson"}-${photo.id}`} type="button" className="group overflow-hidden rounded-2xl border bg-slate-50 text-left dark:bg-slate-900" onClick={() => setPreview({ title, filename: libraryImage ? photo.filename : undefined, contentType: "image/webp", url: previewUrl, downloadUrl })}><img src={previewUrl} alt={title} className="aspect-square w-full object-cover transition group-hover:scale-[1.02]" /><span className="block truncate p-2 text-xs text-slate-500">{libraryImage ? photo.title : photo.authorName}</span></button>; })}</div>{photos.length === 0 && <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-slate-500">Преподаватель пока не добавил изображений.</p>}{photos.length > 3 && <ShowMoreButton expanded={photosExpanded} remaining={photos.length - 3} className="mt-3" onToggle={() => setPhotosExpanded((value) => !value)} />}</TabsContent>
    </Tabs>}</>;
  return <>{embedded ? <div>{content}</div> : <AppCard className="mt-5">{content}</AppCard>}<MaterialPreviewDialog item={preview} onOpenChange={(open) => !open && setPreview(null)} /></>;
}
