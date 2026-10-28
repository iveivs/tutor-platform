import "server-only";

import { base64UrlDecode } from "@/scripts/web-push.mjs";

/** Public VAPID key for browsers, or null when push is not configured on this server. */
export function vapidPublicKey() {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  if (!key) return null;
  const bytes = base64UrlDecode(key);
  return bytes.length === 65 && bytes[0] === 4 ? key : null;
}
