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

export function TeacherInviteAccept({ token }: { token: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [professionalTitle, setProfessionalTitle] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPersonalData, setAcceptedPersonalData] = useState(false);

  useEffect(() => {
    void fetch(`/api/auth/teacher-invite?token=${encodeURIComponent(token)}`)
      .then(async (response) => ({ response, data: await response.json() as { error?: string; name?: string; email?: string; professionalTitle?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error ?? "Ссылка недействительна");
        setName(data.name ?? ""); setEmail(data.email ?? ""); setProfessionalTitle(data.professionalTitle ?? "");
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось открыть приглашение"))
      .finally(() => setReady(true));
  }, [token]);

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError("");
    if (password !== confirmation) return setError("Пароли не совпадают");
    setPending(true);
    try {
      const response = await fetch("/api/auth/teacher-invite", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password, acceptedTerms, acceptedPersonalData }),
      });
      const data = await response.json() as { error?: string; existingAccount?: boolean };
      if (!response.ok) { if (data.existingAccount) setExistingAccount(true); throw new Error(data.error ?? "Не удалось создать кабинет"); }
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать кабинет"); }
    finally { setPending(false); }
  };

  return <main className="grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"><section className="card w-full max-w-md p-7 sm:p-9">
    <div className="mb-7 text-center"><BrandIcon className="mx-auto size-14 shadow-lg" /><h1 className="mt-5 text-3xl font-bold tracking-tight">Приглашение преподавателя</h1>{name && <p className="mt-2 text-slate-500">{professionalTitle || "Преподаватель"} · {name}</p>}</div>
    {!ready ? <p className="text-center text-slate-500">Проверяем приглашение…</p> : done ? <div className="text-center"><CheckCircle2 className="mx-auto size-12 text-emerald-600" /><h2 className="mt-4 text-xl font-bold">Кабинет готов</h2><p className="mt-2 text-slate-500">Теперь войдите с email <strong>{email}</strong> и созданным паролем.</p><Link href="/" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 font-semibold text-white">Перейти ко входу</Link></div> : error && !email ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : <form className="space-y-5" onSubmit={submit}>
      <div className="space-y-2"><Label>Email</Label><Input value={email} disabled className="h-12 rounded-xl opacity-80" /></div>
      <div className="space-y-2"><Label htmlFor="teacher-password">{existingAccount ? "Введите прежний пароль" : "Придумайте пароль"}</Label><Input id="teacher-password" type="password" autoComplete={existingAccount ? "current-password" : "new-password"} minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl" /></div>
      <div className="space-y-2"><Label htmlFor="teacher-password-confirmation">Повторите пароль</Label><Input id="teacher-password-confirmation" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required className="h-12 rounded-xl" /></div>
      <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedTerms} onCheckedChange={(value) => setAcceptedTerms(value === true)} className="mt-0.5" /><span>Я принимаю <Link href="/legal/terms" target="_blank" className="text-indigo-600 underline">Пользовательское соглашение</Link> и <Link href="/legal/content-rules" target="_blank" className="text-indigo-600 underline">Правила размещения контента</Link>.</span></label>
      <label className="flex items-start gap-3 text-sm leading-5"><Checkbox checked={acceptedPersonalData} onCheckedChange={(value) => setAcceptedPersonalData(value === true)} className="mt-0.5" /><span>Я даю отдельное <Link href="/legal/personal-data-consent" target="_blank" className="text-indigo-600 underline">согласие на обработку персональных данных</Link> и ознакомился(-ась) с <Link href="/legal/privacy" target="_blank" className="text-indigo-600 underline">Политикой</Link>.</span></label>
      <p className="rounded-xl bg-indigo-50 px-4 py-3 text-sm text-indigo-800">После активации вы получите отдельный кабинет преподавателя с бессрочным бесплатным доступом.</p>
      {error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}
      <Button type="submit" disabled={pending || !acceptedTerms || !acceptedPersonalData} className="h-12 w-full rounded-xl bg-indigo-600">{pending ? "Создаём кабинет…" : "Активировать кабинет"}</Button>
    </form>}
    <LegalLinks className="mt-7" />
  </section></main>;
}
