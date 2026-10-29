"use client";

import { FormEvent, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { BrandIcon } from "@/components/brand-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LegalLinks } from "@/components/legal-links";
import { PasswordInput } from "@/components/common/password-input";
import { GuardianFields, guardianDraft, guardianDraftValid, guardianFromDraft, type GuardianDraft } from "@/components/features/students/guardian-dialog";
import type { Guardian } from "@/lib/guardian";

export function InviteAccept({ token }: { token: string }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [ready, setReady] = useState(false); const [done, setDone] = useState(false); const [pending, setPending] = useState(false); const [existingAccount, setExistingAccount] = useState(false); const [reusedAccount, setReusedAccount] = useState(false);
  const [participantStatus, setParticipantStatus] = useState<"adult" | "legal_representative" | "">("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedContentRules, setAcceptedContentRules] = useState(false);
  const [acceptedPersonalData, setAcceptedPersonalData] = useState(false);
  const [acceptedParentalConsent, setAcceptedParentalConsent] = useState(false);
  const [guardian, setGuardian] = useState<GuardianDraft>(() => ({ ...guardianDraft(), enabled: true }));
  useEffect(() => { void fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`).then(async (response) => ({ response, data: await response.json() as { error?: string; name?: string; email?: string; guardian?: Guardian | null } })).then(({ response, data }) => { if (!response.ok) throw new Error(data.error ?? "Ссылка недействительна"); setName(data.name ?? ""); setEmail(data.email ?? ""); if (data.guardian) setGuardian(guardianDraft(data.guardian)); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось открыть приглашение")).finally(() => setReady(true)); }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setPending(true);
    try { const response = await fetch("/api/auth/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password, participantStatus, acceptedTerms, acceptedContentRules, acceptedPersonalData, acceptedParentalConsent, guardian: participantStatus === "legal_representative" ? guardianFromDraft(guardian) : null }) }); const data = await response.json() as { error?: string; existingAccount?: boolean; reusedAccount?: boolean }; if (!response.ok) { if (data.existingAccount) setExistingAccount(true); throw new Error(data.error ?? "Не удалось создать аккаунт"); } setReusedAccount(Boolean(data.reusedAccount)); setDone(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать аккаунт"); }
    finally { setPending(false); }
  };
  const parentalRequired = participantStatus === "legal_representative";
  const canSubmit = Boolean(participantStatus && acceptedTerms && acceptedContentRules && acceptedPersonalData && (!parentalRequired || acceptedParentalConsent && guardianDraftValid(guardian)));
  return <main className="grid min-h-screen place-items-center bg-background px-4 pb-8 pt-20 text-foreground sm:py-8"><section className="card w-full max-w-md p-7 sm:p-9"><div className="mb-7 text-center"><BrandIcon className="mx-auto size-14 shadow-lg" /><h1 className="mt-5 text-3xl font-bold tracking-tight">Кабинет ученика</h1>{name && <p className="mt-2 text-ink-muted">Здравствуйте, {name}</p>}</div>{!ready ? <p className="text-center text-ink-muted">Проверяем приглашение…</p> : done ? <div className="text-center"><CheckCircle2 className="mx-auto size-12 text-success-text" /><h2 className="mt-4 text-xl font-bold">Аккаунт готов</h2><p className="mt-2 text-ink-muted">Теперь войдите с вашим email и {reusedAccount ? "прежним" : "новым"} паролем.</p><Link href="/" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-brand-solid px-5 font-semibold text-white">Перейти ко входу</Link></div> : error && !email ? <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</p> : <form className="space-y-5" onSubmit={submit}>
    <div className="space-y-2"><Label>Email</Label><Input value={email} disabled className="h-12 rounded-xl opacity-80" /></div>
    <div className="space-y-2"><Label htmlFor="new-password">{existingAccount ? "Введите прежний пароль" : "Придумайте пароль"}</Label><PasswordInput id="new-password" autoComplete={existingAccount ? "current-password" : "new-password"} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl" /><p className="text-xs text-ink-muted">{existingAccount ? "Так мы безопасно подтвердим, что аккаунт принадлежит вам." : "Минимум 8 символов."}</p></div>
    <fieldset className="space-y-3 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-semibold">Кто принимает приглашение</legend>
      <label className="flex gap-3 text-sm"><input type="radio" name="participant-status" value="adult" checked={participantStatus === "adult"} onChange={() => setParticipantStatus("adult")} className="mt-1" /><span>Мне исполнилось 18 лет</span></label>
      <label className="flex gap-3 text-sm"><input type="radio" name="participant-status" value="legal_representative" checked={participantStatus === "legal_representative"} onChange={() => setParticipantStatus("legal_representative")} className="mt-1" /><span>Я законный представитель несовершеннолетнего ученика</span></label>
      <p className="text-xs text-ink-muted">Если ученику нет 18 лет, форму заполняет его законный представитель.</p>
      {parentalRequired && <div className="space-y-2 border-t border-border pt-3"><p className="text-xs text-ink-muted">Так вас будут видеть преподаватель и группа в сообщениях; в расписании остаётся имя ученика.</p><GuardianFields draft={guardian} onChange={setGuardian} nameLabel="Ваше имя" relationLabel="Вы ученику" /></div>}
    </fieldset>
    <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedTerms} onCheckedChange={(value) => setAcceptedTerms(value === true)} className="mt-0.5" /><span>Я принимаю <Link href="/legal/terms" target="_blank" className="text-brand-text underline">Пользовательское соглашение</Link>.</span></label>
    <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedContentRules} onCheckedChange={(value) => setAcceptedContentRules(value === true)} className="mt-0.5" /><span>Я принимаю <Link href="/legal/content-rules" target="_blank" className="text-brand-text underline">Правила размещения пользовательского контента</Link>, подтверждаю наличие необходимых прав и согласий и несу ответственность за загружаемые мной тексты, документы и изображения.</span></label>
    <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedPersonalData} onCheckedChange={(value) => setAcceptedPersonalData(value === true)} className="mt-0.5" /><span>Я даю отдельное <Link href="/legal/personal-data-consent" target="_blank" className="text-brand-text underline">согласие на обработку персональных данных</Link> и ознакомился(-ась) с <Link href="/legal/privacy" target="_blank" className="text-brand-text underline">Политикой</Link>.</span></label>
    {parentalRequired && <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedParentalConsent} onCheckedChange={(value) => setAcceptedParentalConsent(value === true)} className="mt-0.5" /><span>Я подтверждаю полномочия законного представителя и принимаю <Link href="/legal/parental-consent" target="_blank" className="text-brand-text underline">согласие в отношении несовершеннолетнего</Link>.</span></label>}
    {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm font-medium text-danger-ink">{error}</p>}
    <Button type="submit" disabled={pending || !canSubmit} className="h-12 w-full rounded-xl bg-brand-solid">{pending ? "Проверяем…" : existingAccount ? "Подключить существующий аккаунт" : "Создать аккаунт"}</Button>
  </form>}<LegalLinks className="mt-7" /></section></main>;
}
