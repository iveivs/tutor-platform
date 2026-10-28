"use client";

import { useState } from "react";
import { Check, Copy, Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Teacher accounts are invite-only (see app/api/auth/register), so «Начать» asks the owner for an invitation.
const TELEGRAM_URL = "https://t.me/iveivs";
const CONTACT_EMAIL = "veiv@mail.ru";

export function StartDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(CONTACT_EMAIL); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* The address stays visible and selectable. */ }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-2xl">Как получить кабинет</DialogTitle>
          <DialogDescription>Сейчас новые кабинеты преподавателей открываем по приглашению. Напишите нам, и мы пришлём персональную ссылку.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Button asChild className="h-12 rounded-xl bg-brand-solid text-base hover:bg-brand-solid-hover">
            <a href={TELEGRAM_URL} target="_blank" rel="noopener noreferrer"><Send />Написать в Telegram</a>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl bg-surface text-base dark:bg-surface">
            <a href={`mailto:${CONTACT_EMAIL}`}><Mail />Написать на почту</a>
          </Button>
          <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-subtle px-4 py-2 text-sm">
            <span className="min-w-0 select-all truncate font-medium text-ink-strong">{CONTACT_EMAIL}</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => void copy()} className="shrink-0 text-brand-text">{copied ? <Check /> : <Copy />}{copied ? "Скопировано" : "Скопировать"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
