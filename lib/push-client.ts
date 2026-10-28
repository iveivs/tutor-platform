"use client";

import { useEffect, useRef } from "react";
import { appFetch } from "@/lib/client-fetch";

export type PushDeviceState = "unsupported" | "ios-home-screen" | "not-configured" | "denied" | "off" | "on";

const SERVICE_WORKER_URL = "/sw.js";

export function isIosDevice() {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function pushApiAvailable() {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function existingSubscription() {
  if (!pushApiAvailable()) return null;
  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_URL);
  return registration ? registration.pushManager.getSubscription() : null;
}

function applicationServerKey(publicKey: string) {
  const base64 = publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(publicKey.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

async function saveSubscription(subscription: PushSubscription, language: "ru" | "en") {
  const json = subscription.toJSON();
  const response = await appFetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, language }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(result.error ?? "Не удалось включить уведомления");
  }
}

/** Server key plus what this browser can do right now. */
export async function readPushDeviceState(): Promise<{ state: PushDeviceState; publicKey: string | null }> {
  if (isIosDevice() && !isStandalone()) return { state: "ios-home-screen", publicKey: null };
  if (!pushApiAvailable()) return { state: "unsupported", publicKey: null };
  const response = await appFetch("/api/push/subscription", { cache: "no-store" });
  const status = response.ok ? await response.json() as { publicKey: string | null } : { publicKey: null };
  if (!status.publicKey) return { state: "not-configured", publicKey: null };
  if (Notification.permission === "denied") return { state: "denied", publicKey: status.publicKey };
  const subscription = Notification.permission === "granted" ? await existingSubscription() : null;
  return { state: subscription ? "on" : "off", publicKey: status.publicKey };
}

/** Must be called straight from a tap: Safari only asks for permission inside a user gesture. */
export async function enablePushOnThisDevice(publicKey: string, language: "ru" | "en") {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "denied" : "off";
  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const key = applicationServerKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription) {
    // A subscription made with an older server key cannot receive our messages.
    const current = subscription.options.applicationServerKey;
    const same = current && new Uint8Array(current).every((byte, index) => byte === key[index]);
    if (!same) {
      await subscription.unsubscribe();
      subscription = null;
    }
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(subscription, language);
  return "on" as const;
}

export async function disablePushOnThisDevice() {
  const subscription = await existingSubscription();
  if (!subscription) return;
  await appFetch("/api/push/subscription", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => false);
}

export function setIconBadge(count: number) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  void (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => undefined);
}

/**
 * Keeps the home-screen badge equal to the in-app counter, re-saves this device's
 * subscription for the signed-in account and language, and follows notification clicks
 * that arrive while the app is already open.
 */
export function usePushDevice(badgeCount: number | null, language: "ru" | "en", onOpenPath: (path: string) => void) {
  const openPath = useRef(onOpenPath);
  useEffect(() => { openPath.current = onOpenPath; });

  useEffect(() => {
    if (badgeCount !== null) setIconBadge(badgeCount);
  }, [badgeCount]);

  useEffect(() => {
    if (!pushApiAvailable() || Notification.permission !== "granted") return;
    void existingSubscription().then((subscription) => subscription ? saveSubscription(subscription, language) : undefined).catch(() => undefined);
  }, [language]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: string } | null;
      if (data?.type === "tyuttori:open" && typeof data.path === "string") openPath.current(data.path);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);
}
