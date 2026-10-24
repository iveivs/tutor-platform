"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

// Interface redesign switch. "v2" is enabled per device and exposed as <html data-design="v2">,
// so new token values and V2 components can ship to production without affecting other users.
// Opening any page with ?design=v2 (or ?design=v1) also unlocks the switch in settings on that device.
export type DesignVersion = "v1" | "v2";

type DesignContextValue = {
  design: DesignVersion;
  setDesign: (design: DesignVersion) => void;
  previewUnlocked: boolean;
};

const DesignContext = createContext<DesignContextValue>({ design: "v1", setDesign: () => undefined, previewUnlocked: false });
const STORAGE_KEY = "tutor-platform-design";
const UNLOCK_KEY = "tutor-platform-design-preview";
const DESIGN_EVENT = "tutor-platform-design-change";

const subscribeToDesign = (onStoreChange: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === UNLOCK_KEY) onStoreChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DESIGN_EVENT, onStoreChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(DESIGN_EVENT, onStoreChange); };
};
const readDesign = (): DesignVersion => {
  try { return window.localStorage.getItem(STORAGE_KEY) === "v2" ? "v2" : "v1"; } catch { return "v1"; }
};
const readServerDesign = (): DesignVersion => "v1";
const readUnlocked = () => {
  try { return window.localStorage.getItem(UNLOCK_KEY) === "1"; } catch { return false; }
};
const readServerUnlocked = () => false;
const storeDesign = (design: DesignVersion) => {
  try { window.localStorage.setItem(STORAGE_KEY, design); } catch { /* Storage unavailable: the switch stays at its default. */ }
  window.dispatchEvent(new Event(DESIGN_EVENT));
};

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const design = useSyncExternalStore(subscribeToDesign, readDesign, readServerDesign);
  const previewUnlocked = useSyncExternalStore(subscribeToDesign, readUnlocked, readServerUnlocked);
  useEffect(() => { document.documentElement.dataset.design = design; }, [design]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("design");
    if (requested !== "v1" && requested !== "v2") return;
    try { window.localStorage.setItem(UNLOCK_KEY, "1"); } catch { /* Storage unavailable: the switch stays hidden. */ }
    storeDesign(requested);
    url.searchParams.delete("design");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  const value = useMemo(() => ({ design, setDesign: storeDesign, previewUnlocked }), [design, previewUnlocked]);
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}

export function useDesign() { return useContext(DesignContext); }
