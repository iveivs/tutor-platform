"use client";

import { useEffect, useSyncExternalStore } from "react";
import { appFetch } from "@/lib/client-fetch";

type Unread = Record<string, number>;

// Unread group chat messages per group, shared by every badge; refreshed every minute, when the tab
// becomes visible again and right after a chat tab has been read.
let current: Unread = {};
const listeners = new Set<() => void>();

export async function refreshGroupChatUnread() {
  try {
    const response = await appFetch("/api/group-chat", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json() as { unread: Array<{ groupId: string; announcement: number; discussion: number }> };
    current = Object.fromEntries(data.unread.map((row) => [row.groupId, row.announcement + row.discussion]));
    listeners.forEach((listener) => listener());
  } catch { /* Badges keep their last value. */ }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useGroupChatUnread() {
  const unread = useSyncExternalStore(subscribe, () => current, () => current);
  useEffect(() => {
    void refreshGroupChatUnread();
    const onVisible = () => { if (document.visibilityState === "visible") void refreshGroupChatUnread(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void refreshGroupChatUnread(), 60_000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); };
  }, []);
  return unread;
}
