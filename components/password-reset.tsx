"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type RecoverySession = { accessToken: string };

export function readRecoverySession(): RecoverySession | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = params.get("access_token");
  if (params.get("type") !== "recovery" || !accessToken) return null;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  return { accessToken };
}

export function PasswordReset({ session, onBack }: { session: RecoverySession; onBack: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    if (password !== confirmation) return setError("Пароли не совпадают");
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accessToken: session.accessToken, password }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Не удалось изменить пароль");
      setComplete(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось изменить пароль");
    } finally {
      setPending(false);
    }
  };

  return <main className="grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"><section className="card w-full max-w-md p-7 sm:p-9"><div className="mb-7 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><KeyRound className="size-7" /></span><h1 className="mt-5 text-3xl font-bold tracking-tight">Новый пароль</h1><p className="mt-2 text-slate-500">Придумайте пароль длиной не менее 8 символов</p></div>{complete ? <div className="space-y-5"><p className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">Пароль изменён. Теперь можно войти с новым паролем.</p><Button type="button" onClick={onBack} className="h-12 w-full rounded-xl bg-indigo-600 text-base"><ArrowLeft />Перейти ко входу</Button></div> : <form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label htmlFor="new-password">Новый пароль</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl" /></div><div className="space-y-2"><Label htmlFor="confirm-password">Повторите пароль</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required className="h-12 rounded-xl" /></div>{error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}<Button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-indigo-600 text-base"><KeyRound />{pending ? "Сохраняем…" : "Сохранить пароль"}</Button></form>}</section></main>;
}
