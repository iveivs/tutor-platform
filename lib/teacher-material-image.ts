import "server-only";

import sharp from "sharp";
import { isTeacherMaterialImageFilename, sanitizeMaterialFilename } from "./teacher-material-files";

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_IMAGE_EDGE = 2_000;

export async function optimizeTeacherMaterialImage(filename: string, bytes: Uint8Array) {
  if (!isTeacherMaterialImageFilename(filename)) return null;
  try {
    const data = await sharp(Buffer.from(bytes), { failOn: "warning", limitInputPixels: MAX_IMAGE_PIXELS })
      .rotate()
      .resize({ width: MAX_IMAGE_EDGE, height: MAX_IMAGE_EDGE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const safe = sanitizeMaterialFilename(filename).replace(/\.(jpe?g|png|webp)$/i, "");
    return { body: new Uint8Array(data), filename: `${safe || "image"}.webp`, contentType: "image/webp" as const, extension: "webp" as const };
  } catch {
    return null;
  }
}
