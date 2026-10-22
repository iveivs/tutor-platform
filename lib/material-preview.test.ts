import { describe, expect, it } from "vitest";
import { shouldUseDirectPdfPreview } from "./material-preview";

describe("shouldUseDirectPdfPreview", () => {
  it("uses the original direct preview for PDFs on iPhone", () => {
    expect(shouldUseDirectPdfPreview("application/pdf", {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      platform: "iPhone",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("recognizes an iPad requesting the desktop version of a site", () => {
    expect(shouldUseDirectPdfPreview("application/pdf", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)",
      platform: "MacIntel",
      maxTouchPoints: 5,
    })).toBe(true);
  });

  it("keeps the embedded viewer for desktop and non-PDF materials", () => {
    const desktop = { userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel", maxTouchPoints: 0 };
    expect(shouldUseDirectPdfPreview("application/pdf", desktop)).toBe(false);
    expect(shouldUseDirectPdfPreview("image/webp", { ...desktop, platform: "iPhone", maxTouchPoints: 5 })).toBe(false);
  });
});
