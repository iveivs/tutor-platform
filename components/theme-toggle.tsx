"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();

  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => mounted && setTheme(dark ? "light" : "dark")}
      className={compact
        ? "grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
        : "flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      {!compact && <span>{dark ? "Светлая тема" : "Тёмная тема"}</span>}
    </button>
  );
}
