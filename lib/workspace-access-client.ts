"use client";

import { useEffect, useSyncExternalStore } from "react";
import { appFetch } from "@/lib/client-fetch";
import type { AccessGrant, WorkspaceAccessMode } from "@/lib/workspace-access";

export type SubscriptionPayment = { id: string; amountCents: number; months: number; paidOn: string; method: "transfer" | "cash" | "other"; receiptRef: string; accessUntil: number; status: "paid" | "refunded" };
export type WorkspaceAccess = {
  accessMode: WorkspaceAccessMode;
  accessGrant?: AccessGrant;
  accessExpiresAt?: number | null;
  priceCents?: number | null;
  payments?: SubscriptionPayment[];
};

// One shared copy for the banner, the settings card and the student portal; refreshed when the
// tab becomes visible again and every 10 minutes, so a renewal shows up without a reload.
let current: WorkspaceAccess | null = null;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

async function load() {
  inFlight ??= (async () => {
    try {
      const response = await appFetch("/api/subscription", { cache: "no-store" });
      if (response.ok) { current = await response.json() as WorkspaceAccess; listeners.forEach((listener) => listener()); }
    } catch { /* Keep the last known state; the server still enforces access. */ }
    finally { inFlight = null; }
  })();
  return inFlight;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useWorkspaceAccess() {
  const access = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => {
    void load();
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => void load(), 10 * 60 * 1000);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.clearInterval(timer); };
  }, []);
  return access;
}
