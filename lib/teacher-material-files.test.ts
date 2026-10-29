import { describe, expect, it } from "vitest";
import { MAX_TEACHER_AUDIO_BYTES, defaultMaterialTitle, detectTeacherMaterial, isTeacherMaterialImageFilename, materialContentDisposition, materialDownloadDisposition, sanitizeMaterialFilename } from "./teacher-material-files";

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

describe("library audio", () => {
  it("accepts MP3 by its content, not by the extension alone", () => {
    expect(detectTeacherMaterial("track.mp3", new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0]))?.contentType).toBe("audio/mpeg");
    expect(detectTeacherMaterial("track.mp3", new Uint8Array([0xff, 0xfb, 0x90, 0x64]))?.contentType).toBe("audio/mpeg");
    expect(detectTeacherMaterial("track.mp3", new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
    expect(detectTeacherMaterial("track.mp3", new Uint8Array(MAX_TEACHER_AUDIO_BYTES + 1).fill(0xff))).toBeNull();
  });
});
