"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";

const storageKey = "tyuttori_cookie_notice_v1";
const eventName = "tyuttori-cookie-notice-change";

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(eventName, callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener(eventName, callback); };
}

export function CookieNotice() {
  const visible = useSyncExternalStore(subscribe, () => window.localStorage.getItem(storageKey) !== "accepted", () => false);
  if (!visible) return null;
  return <aside className="fixed inset-x-3 bottom-3 z-[100] mx-auto flex max-w-3xl flex-col gap-3 rounded-2xl border border-border bg-background/95 p-4 text-sm text-foreground shadow-2xl backdrop-blur sm:flex-row sm:items-center">
    <p className="flex-1">Сайт использует только технически необходимые cookie для входа и безопасности. Подробнее — в <Link href="/legal/privacy" className="font-medium text-indigo-600 underline">политике</Link>.</p>
    <button type="button" onClick={() => { window.localStorage.setItem(storageKey, "accepted"); window.dispatchEvent(new Event(eventName)); }} className="rounded-xl bg-indigo-600 px-5 py-2.5 font-semibold text-white">Понятно</button>
  </aside>;
}
