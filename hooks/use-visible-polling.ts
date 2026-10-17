"use client";

import { useEffect, useRef } from "react";
import { syncDelayForVisibility } from "@/lib/incremental-sync";

/** Polls quietly while a page is open and refreshes immediately when the user returns. */
export function useVisiblePolling(callback: () => Promise<void>, enabled = true) {
  const callbackRef = useRef(callback);
  const inFlightRef = useRef(false);

  useEffect(() => { callbackRef.current = callback; }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let timer: number | undefined;
    const run = async () => {
      if (inFlightRef.current || !navigator.onLine) return;
      inFlightRef.current = true;
      try { await callbackRef.current(); }
      finally { inFlightRef.current = false; }
    };
    const schedule = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        await run();
        if (active) schedule();
      }, syncDelayForVisibility(document.visibilityState === "visible"));
    };
    const refreshAndReschedule = () => {
      if (document.visibilityState === "visible") void run();
      schedule();
    };
    schedule();
    window.addEventListener("focus", refreshAndReschedule);
    window.addEventListener("online", refreshAndReschedule);
    document.addEventListener("visibilitychange", refreshAndReschedule);
    return () => {
      active = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener("focus", refreshAndReschedule);
      window.removeEventListener("online", refreshAndReschedule);
      document.removeEventListener("visibilitychange", refreshAndReschedule);
    };
  }, [enabled]);
}
