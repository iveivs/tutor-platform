"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function InviteAccept({ token }: { token: string }) {
  const [name, setName] = useState(""); const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [ready, setReady] = useState(false); const [done, setDone] = useState(false); const [pending, setPending] = useState(false);
  useEffect(() => { void fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`).then(async (response) => ({ response, data: await response.json() })).then(({ response, data }) => { if (!response.ok) throw new Error(data.error); setName(data.name); setEmail(data.email); }).catch((reason) => setError(reason instanceof Error ? reason.message : "Не удалось открыть приглашение")).finally(() => setReady(true)); }, [token]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setPending(true);
    try { const response = await fetch("/api/auth/invite", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }) }); const data = await response.json() as { error?: string }; if (!response.ok) throw new Error(data.error ?? "Не удалось создать аккаунт"); setDone(true); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось создать аккаунт"); }
    finally { setPending(false); }
  };
  return <main className="grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"><section className="card w-full max-w-md p-7 sm:p-9"><div className="mb-7 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><CalendarDays className="size-7" /></span><h1 className="mt-5 text-3xl font-bold tracking-tight">Кабинет ученика</h1>{name && <p className="mt-2 text-slate-500">Здравствуйте, {name}</p>}</div>{!ready ? <p className="text-center text-slate-500">Проверяем приглашение…</p> : done ? <div className="text-center"><CheckCircle2 className="mx-auto size-12 text-emerald-600" /><h2 className="mt-4 text-xl font-bold">Аккаунт готов</h2><p className="mt-2 text-slate-500">Теперь войдите с вашим email и новым паролем.</p><Link href="/" className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-indigo-600 px-5 font-semibold text-white">Перейти ко входу</Link></div> : error && !email ? <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p> : <form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label>Email</Label><Input value={email} disabled className="h-12 rounded-xl opacity-80" /></div><div className="space-y-2"><Label htmlFor="new-password">Придумайте пароль</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl" /><p className="text-xs text-slate-500">Минимум 8 символов.</p></div>{error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}<Button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-indigo-600">{pending ? "Создаём аккаунт…" : "Создать аккаунт"}</Button></form>}</section></main>;
}
