"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { appFetch } from "@/lib/client-fetch";

type Reason = "copyright" | "inappropriate" | "personal_data" | "other";
const reasons: Array<[Reason, string]> = [["copyright", "Нарушение авторских прав"], ["inappropriate", "Неприемлемое содержание"], ["personal_data", "Личные данные без согласия"], ["other", "Другое"]];

/** Which stored file a preview URL points to, if it can be reported. */
export function reportTarget(url: string): { resourceType: "teacher_resource" | "lesson_attachment"; resourceId: string } | null {
  const match = url.match(/^\/api\/(teacher-materials|lesson-attachments)\/([^/?#]+)/);
  if (!match) return null;
  return { resourceType: match[1] === "teacher-materials" ? "teacher_resource" : "lesson_attachment", resourceId: decodeURIComponent(match[2]) };
}

// «Пожаловаться» on a file: goes to the platform admin; the teacher never learns who reported.
export function ReportDialog({ url }: { url: string }) {
  const target = reportTarget(url);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Reason>("copyright");
  const [comment, setComment] = useState("");
  const [pending, setPending] = useState(false);
  if (!target) return null;
  const send = async () => {
    setPending(true);
    try {
      const response = await appFetch("/api/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...target, reason, comment: comment.trim() }) });
      if (!response.ok) throw new Error(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Не удалось отправить жалобу");
      toast.success("Жалоба отправлена администрации"); setOpen(false); setComment("");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Не удалось отправить жалобу"); }
    finally { setPending(false); }
  };
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button type="button" variant="ghost" className="mr-auto text-danger-text"><Flag />Пожаловаться</Button></DialogTrigger>
    <DialogContent className="rounded-3xl sm:max-w-md">
      <DialogHeader><DialogTitle>Пожаловаться на материал</DialogTitle><DialogDescription>Жалобу увидит администрация Тьюттори. Преподаватель не узнает, кто пожаловался.</DialogDescription></DialogHeader>
      <fieldset className="flex flex-col gap-2"><legend className="mb-2 text-sm font-semibold">Причина</legend>{reasons.map(([value, label]) => <label key={value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-sm ${reason === value ? "border-brand-solid bg-brand-soft" : "border-line"}`}><input type="radio" name="report-reason" checked={reason === value} onChange={() => setReason(value)} className="accent-[var(--color-brand-solid)]" />{label}</label>)}</fieldset>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">Комментарий (необязательно)<Textarea value={comment} maxLength={500} rows={2} onChange={(event) => setComment(event.target.value)} className="rounded-xl font-normal" /></label>
      <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Отмена</Button><Button disabled={pending} onClick={() => void send()}>{pending ? "Отправляю…" : "Отправить жалобу"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
