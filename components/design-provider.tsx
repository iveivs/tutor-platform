"use client";

import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

// Interface redesign switch, exposed as <html data-design>. "v2" is the default for everyone;
// "v1" (the old interface) is kept per device until the old components are removed.
// It is toggled in settings; ?design=v2 or ?design=v1 sets it on any page.
export type DesignVersion = "v1" | "v2";

type DesignContextValue = {
  design: DesignVersion;
  setDesign: (design: DesignVersion) => void;
};

const DesignContext = createContext<DesignContextValue>({ design: "v2", setDesign: () => undefined });
const STORAGE_KEY = "tutor-platform-design";
const DESIGN_EVENT = "tutor-platform-design-change";

const subscribeToDesign = (onStoreChange: () => void) => {
  const onStorage = (event: StorageEvent) => { if (event.key === STORAGE_KEY) onStoreChange(); };
  window.addEventListener("storage", onStorage);
  window.addEventListener(DESIGN_EVENT, onStoreChange);
  return () => { window.removeEventListener("storage", onStorage); window.removeEventListener(DESIGN_EVENT, onStoreChange); };
};
const readDesign = (): DesignVersion => {
  try { return window.localStorage.getItem(STORAGE_KEY) === "v1" ? "v1" : "v2"; } catch { return "v2"; }
};
const readServerDesign = (): DesignVersion => "v2";
const storeDesign = (design: DesignVersion) => {
  try { window.localStorage.setItem(STORAGE_KEY, design); } catch { /* Storage unavailable: the switch stays at its default. */ }
  window.dispatchEvent(new Event(DESIGN_EVENT));
};

export function DesignProvider({ children }: { children: React.ReactNode }) {
  const design = useSyncExternalStore(subscribeToDesign, readDesign, readServerDesign);
  useEffect(() => { document.documentElement.dataset.design = design; }, [design]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const requested = url.searchParams.get("design");
    if (requested !== "v1" && requested !== "v2") return;
    storeDesign(requested);
    url.searchParams.delete("design");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  }, []);
  const value = useMemo(() => ({ design, setDesign: storeDesign }), [design]);
  return <DesignContext.Provider value={value}>{children}</DesignContext.Provider>;
}

export function useDesign() { return useContext(DesignContext); }
