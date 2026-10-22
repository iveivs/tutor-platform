import { describe, expect, it } from "vitest";
import { shouldOpenPdfInSystemViewer } from "./material-preview";

describe("shouldOpenPdfInSystemViewer", () => {
  it("uses the system viewer for PDFs on iPhone", () => {
    expect(shouldOpenPdfInSystemViewer("application/pdf", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("recognizes an iPad requesting the desktop version of a site", () => {
    expect(shouldOpenPdfInSystemViewer("application/pdf", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("keeps the embedded viewer for desktop and non-PDF materials", () => {
    const desktop = { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 };
    expect(shouldOpenPdfInSystemViewer("application/pdf", desktop)).toBe(false);
    expect(shouldOpenPdfInSystemViewer("image/webp", { ...desktop, platform: "iPhone", maxTouchPoints: 5 })).toBe(false);
  });
});
