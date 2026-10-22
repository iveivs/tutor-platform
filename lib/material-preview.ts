export type MaterialPreviewDevice = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
};

export function shouldUseDirectPdfPreview(contentType: string, device: MaterialPreviewDevice) {
  if (contentType !== "application/pdf") return false;
  return /iPad|iPhone|iPod/i.test(device.userAgent)
    || device.platform === "MacIntel" && device.maxTouchPoints > 1;
}
