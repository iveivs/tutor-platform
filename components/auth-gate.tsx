"use client";

import { FormEvent, useEffect, useState } from "react";
import { CalendarDays, LogIn } from "lucide-react";
import { toast } from "sonner";
import TutorApp from "@/components/tutor-app";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type User = { name: string; email: string; role: "owner" | "teacher" | "student" };

async function loadSession() {
  let response = await fetch("/api/auth/session", { cache: "no-store" });
  if (response.status === 401) {
    const refreshed = await fetch("/api/auth/refresh", { method: "POST" });
    if (refreshed.ok) response = await fetch("/api/auth/session", { cache: "no-store" });
  }
  return response.ok ? response.json() as Promise<{ user?: User }> : null;
}

export function AuthGate({ enabled }: { enabled: boolean }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!enabled);

  useEffect(() => {
    if (!enabled) return;
    void loadSession().then((data) => setUser(data?.user ?? null)).finally(() => setReady(true));
  }, [enabled]);

  const logout = async () => {
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      setUser(null);
    } catch {
      toast.error("Не удалось выйти. Проверьте соединение и попробуйте снова.");
    }
  };
  if (!enabled) return <TutorApp />;
  if (!ready) return <main className="grid min-h-screen place-items-center bg-background text-foreground"><CalendarDays className="size-8 animate-pulse text-indigo-600" /></main>;
  if (!user) return <LoginScreen onSuccess={setUser} />;
  return <TutorApp role={user.role} user={user} onLogout={logout} />;
}

function LoginScreen({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [email, setEmail] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setPending(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      const data = await response.json() as { error?: string; user?: User };
      if (!response.ok || !data.user) throw new Error(data.error ?? "Не удалось войти");
      onSuccess(data.user);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось войти"); }
    finally { setPending(false); }
  };
  return <main className="grid min-h-screen place-items-center bg-background px-4 py-8 text-foreground"><section className="card w-full max-w-md p-7 sm:p-9"><div className="mb-7 text-center"><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200"><CalendarDays className="size-7" /></span><h1 className="mt-5 text-3xl font-bold tracking-tight">Платформа репетитора</h1><p className="mt-2 text-slate-500">Войдите в свой кабинет</p></div><form className="space-y-5" onSubmit={submit}><div className="space-y-2"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required className="h-12 rounded-xl" /></div><div className="space-y-2"><Label htmlFor="password">Пароль</Label><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl" /></div>{error && <p className="rounded-xl bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>}<Button type="submit" disabled={pending} className="h-12 w-full rounded-xl bg-indigo-600 text-base"><LogIn />{pending ? "Входим…" : "Войти"}</Button></form><p className="mt-6 text-center text-sm text-slate-500">Если вас пригласили как ученика, откройте персональную ссылку преподавателя.</p></section></main>;
}
