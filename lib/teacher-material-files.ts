export const MAX_TEACHER_MATERIAL_BYTES = 25 * 1024 * 1024;
export const MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH = 50;
export const MAX_WORKSPACE_MATERIAL_BYTES = 5 * 1024 * 1024 * 1024;

export type TeacherMaterialContentType =
  | "application/pdf"
  | "application/msword"
  | "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  | "image/webp";

const contentTypesByExtension: Record<string, TeacherMaterialContentType> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function sanitizeMaterialFilename(value: string) {
  const basename = value.split(/[\\/]/).pop() ?? "material";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, 160) || "material";
}

export function defaultMaterialTitle(filename: string) {
  const withoutExtension = filename.replace(/\.(pdf|docx?|jpe?g|png|webp)$/i, "").trim();
  return (withoutExtension || "Материал урока").slice(0, 120);
}

export function isTeacherMaterialImageFilename(filename: string) {
  return /\.(jpe?g|png|webp)$/i.test(filename);
}

export function detectTeacherMaterial(filename: string, bytes: Uint8Array): { contentType: TeacherMaterialContentType; extension: "pdf" | "doc" | "docx" } | null {
  const extension = filename.toLowerCase().split(".").pop();
  if (extension !== "pdf" && extension !== "doc" && extension !== "docx") return null;
  if (extension === "pdf") {
    const pdfHeader = new TextDecoder("ascii").decode(bytes.slice(0, 5));
    return pdfHeader === "%PDF-" ? { contentType: contentTypesByExtension.pdf, extension } : null;
  }
  if (extension === "doc") {
    const oleHeader = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
    return oleHeader.every((byte, index) => bytes[index] === byte) ? { contentType: contentTypesByExtension.doc, extension } : null;
  }
  const zipHeader = bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07);
  if (!zipHeader) return null;
  const containerText = new TextDecoder("latin1").decode(bytes);
  return containerText.includes("[Content_Types].xml") && containerText.includes("word/")
    ? { contentType: contentTypesByExtension.docx, extension }
    : null;
}

export function materialContentDisposition(filename: string, disposition: "attachment" | "inline" = "attachment") {
  const safe = sanitizeMaterialFilename(filename);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${disposition}; filename="${ascii || "material"}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

export function materialDownloadDisposition(filename: string) {
  return materialContentDisposition(filename, "attachment");
}
