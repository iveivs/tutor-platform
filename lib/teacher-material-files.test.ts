import { describe, expect, it } from "vitest";
import { defaultMaterialTitle, detectTeacherMaterial, isTeacherMaterialImageFilename, materialContentDisposition, materialDownloadDisposition, sanitizeMaterialFilename } from "./teacher-material-files";

describe("teacher material files", () => {
  it("recognizes PDF by extension and signature", () => {
    expect(detectTeacherMaterial("plan.pdf", new TextEncoder().encode("%PDF-1.7"))?.contentType).toBe("application/pdf");
    expect(detectTeacherMaterial("plan.pdf", new TextEncoder().encode("not pdf"))).toBeNull();
  });

  it("recognizes legacy Word and DOCX containers", () => {
    expect(detectTeacherMaterial("plan.doc", Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))?.extension).toBe("doc");
    expect(detectTeacherMaterial("plan.docx", new TextEncoder().encode("PK\u0003\u0004[Content_Types].xml word/document.xml"))?.extension).toBe("docx");
    expect(detectTeacherMaterial("archive.docx", new TextEncoder().encode("PK\u0003\u0004random.zip"))).toBeNull();
  });

  it("sanitizes names and prepares a safe attachment header", () => {
    expect(sanitizeMaterialFilename("../План\u0000 урока.pdf")).toBe("План урока.pdf");
    expect(defaultMaterialTitle("План урока.pdf")).toBe("План урока");
    expect(materialDownloadDisposition("План урока.pdf")).toContain("filename*=UTF-8''");
    expect(materialContentDisposition("План урока.pdf", "inline")).toMatch(/^inline;/);
  });

  it("recognizes supported image filenames and removes their extension from the default title", () => {
    expect(isTeacherMaterialImageFilename("photo.JPEG")).toBe(true);
    expect(isTeacherMaterialImageFilename("photo.gif")).toBe(false);
    expect(defaultMaterialTitle("Упражнение.png")).toBe("Упражнение");
  });
});
