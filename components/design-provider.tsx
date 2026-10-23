"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

// Interface redesign switch. "v2" is enabled per device and exposed as <html data-design="v2">,
// so new token values and V2 components can ship to production without affecting other users.
export type DesignVersion = "v1" | "v2";

type DesignContextValue = {
  design: DesignVersion;
  setDesign: (design: DesignVersion) => void;
};

const DesignContext = createContext<DesignContextValue>({ design: "v1", setDesign: () => undefined });
const STORAGE_KEY = "tutor-platform-design";
const DESIGN_EVENT = "tutor-platform-design-change";

const subscribeToDesign = (onStoreChange: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) onStoreChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DESIGN_EVENT, onStoreChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(DESIGN_EVENT, onStoreChange); };
};
const readDesign = (): DesignVersion => {
  try { return window.localStorage.getItem(STORAGE_KEY) === "v2" ? "v2" : "v1"; } catch { return "v1"; }
};
const readServerDesign = (): DesignVersion => "v1";
const storeDesign = (design: DesignVersion) => {
  try { window.localStorage.setItem(STORAGE_KEY, design); } catch { /* Storage unavailable: keep the current session value only. */ }
  window.dispatchEvent(new Event(DESIGN_EVENT));
};

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const design = useSyncExternalStore(subscribeToDesign, readDesign, readServerDesign);
  useEffect(() => { document.documentElement.dataset.design = design; }, [design]);
  const value = useMemo(() => ({ design, setDesign: storeDesign }), [design]);
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}

export function useDesign() { return useContext(DesignContext); }
