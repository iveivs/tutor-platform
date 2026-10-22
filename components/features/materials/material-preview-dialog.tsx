"use client";
/* eslint-disable @next/next/no-img-element -- protected images require the signed-in user's session cookie. */

import { useEffect, useRef, useState } from "react";
import { Download, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { appFetch } from "@/lib/client-fetch";

export type MaterialPreviewItem = {
  title: string;
  filename?: string;
  contentType: string;
  url: string;
  downloadUrl?: string;
};

export function MaterialPreviewDialog({ item, onOpenChange }: { item: MaterialPreviewItem | null; onOpenChange: (open: boolean) => void }) {
  const docxRoot = useRef<HTMLDivElement>(null);
  const [docxResult, setDocxResult] = useState<{ url: string; state: "ready" | "error" }>({ url: "", state: "error" });
  const isImage = item?.contentType.startsWith("image/") ?? false;
  const isPdf = item?.contentType === "application/pdf";
  const isDocx = item?.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const docxState = item && docxResult.url === item.url ? docxResult.state : "loading";

  useEffect(() => {
    if (!item || !isDocx) return;
    let active = true;
    void (async () => {
      try {
        const response = await appFetch(item.url, { cache: "no-store" });
        if (!response.ok) throw new Error("preview_failed");
        const blob = await response.blob();
        const { renderAsync } = await import("docx-preview");
        if (!active || !docxRoot.current) return;
        docxRoot.current.replaceChildren();
        await renderAsync(blob, docxRoot.current, docxRoot.current, { breakPages: true, ignoreWidth: true, useBase64URL: true });
        if (active) setDocxResult({ url: item.url, state: "ready" });
      } catch {
        if (active) setDocxResult({ url: item.url, state: "error" });
      }
    })();
    return () => { active = false; };
  }, [isDocx, item]);

  const downloadUrl = item?.downloadUrl ?? item?.url ?? "#";
  return <Dialog open={Boolean(item)} onOpenChange={onOpenChange}><DialogContent className="flex max-h-[94vh] flex-col overflow-hidden p-0 sm:max-w-5xl">
    <DialogHeader className="border-b px-5 py-4 pr-14"><DialogTitle className="truncate">{item?.title ?? "Просмотр материала"}</DialogTitle><DialogDescription className="truncate">{item?.filename ?? "Материал урока"}</DialogDescription></DialogHeader>
    <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3 dark:bg-slate-950 sm:p-5">
      {item && isImage && <img src={item.url} alt={item.title} className="mx-auto max-h-[72vh] max-w-full rounded-xl object-contain shadow-sm" />}
      {item && isPdf && <iframe src={item.url} title={item.title} className="h-[72vh] min-h-[420px] w-full rounded-xl border bg-white" />}
      {item && isDocx && <><div ref={docxRoot} className={`mx-auto min-h-[420px] max-w-4xl overflow-hidden rounded-xl bg-white text-slate-950 shadow-sm ${docxState === "ready" ? "block" : "hidden"}`} />{docxState === "loading" && <p className="grid min-h-[420px] place-items-center text-sm text-slate-500">Открываю документ…</p>}{docxState === "error" && <PreviewUnavailable />}</>}
      {item && !isImage && !isPdf && !isDocx && <PreviewUnavailable />}
    </div>
    <DialogFooter className="border-t px-5 py-4"><Button variant="outline" onClick={() => onOpenChange(false)}>Закрыть</Button><Button asChild><a href={downloadUrl}><Download />Скачать</a></Button></DialogFooter>
  </DialogContent></Dialog>;
}

function PreviewUnavailable({ kind = "document" }: { kind?: "document" | "pdf" }) {
  return <div className="grid min-h-[420px] place-items-center text-center"><div><FileText className="mx-auto mb-3 size-10 text-slate-400" /><p className="font-semibold text-slate-700 dark:text-slate-200">{kind === "pdf" ? "Не удалось открыть PDF" : "Этот формат нельзя показать в браузере"}</p><p className="mt-1 text-sm text-slate-500">{kind === "pdf" ? "Скачайте файл и откройте его на устройстве." : "Скачайте файл, чтобы открыть его в приложении Word."}</p></div></div>;
}
