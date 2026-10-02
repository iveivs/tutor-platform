"use client";

import { useSyncExternalStore } from "react";
import { Languages, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useLanguage } from "@/components/language-provider";

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);
  const { resolvedTheme, setTheme } = useTheme();
  const { language, setLanguage } = useLanguage();

  const dark = mounted && resolvedTheme === "dark";
  const label = dark ? "Включить светлую тему" : "Включить тёмную тему";

  const buttonClass = compact
    ? "grid size-10 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
    : "flex min-h-11 w-full items-center gap-3 rounded-xl px-4 text-sm text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";

  return (
    <div className={compact ? "flex items-center gap-2" : "space-y-1"}>
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => mounted && setTheme(dark ? "light" : "dark")}
      className={buttonClass}
    >
      {dark ? <Sun className="size-5" /> : <Moon className="size-5" />}
      {!compact && <span>{dark ? "Светлая тема" : "Тёмная тема"}</span>}
    </button>
    <button
      type="button"
      data-no-translate
      aria-label={language === "ru" ? "Switch to English" : "Переключить на русский язык"}
      title={language === "ru" ? "English" : "Русский"}
      onClick={() => setLanguage(language === "ru" ? "en" : "ru")}
      className={buttonClass}
    >
      {compact ? <span className="text-xs font-bold">{language === "ru" ? "EN" : "RU"}</span> : <><Languages className="size-5" /><span>{language === "ru" ? "English" : "Русский"}</span></>}
    </button>
    </div>
  );
}
