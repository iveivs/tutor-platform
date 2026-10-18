import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeTeacherMaterialImage } from "./teacher-material-image";

describe("teacher material image optimization", () => {
  it("rotates, resizes and converts a supported image to WebP", async () => {
    const source = await sharp({ create: { width: 3_000, height: 1_500, channels: 3, background: "#4f46e5" } }).png().toBuffer();
    const result = await optimizeTeacherMaterialImage("Упражнение.png", source);
    const metadata = await sharp(result?.body).metadata();

    expect(result?.filename).toBe("Упражнение.webp");
    expect(result?.contentType).toBe("image/webp");
    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBe(2_000);
    expect(metadata.height).toBe(1_000);
  });

  it("rejects unsupported extensions and damaged image data", async () => {
    expect(await optimizeTeacherMaterialImage("image.gif", new Uint8Array([1, 2, 3]))).toBeNull();
    expect(await optimizeTeacherMaterialImage("image.jpg", new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
