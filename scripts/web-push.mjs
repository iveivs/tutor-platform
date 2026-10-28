// Minimal Web Push sender (RFC 8291 aes128gcm payload + RFC 8292 VAPID) on node:crypto,
// shared by the worker and the app so no extra npm dependency has to reach the standalone image.
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign } from "node:crypto";

const RECORD_SIZE = 4096;

export function base64UrlDecode(value) {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function base64UrlEncode(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Push services we deliver to. Anything else is rejected so a stored endpoint cannot turn
// the worker into a request proxy to arbitrary hosts.
export function isAllowedPushEndpoint(endpoint) {
  let url;
  try {
    url = new URL(String(endpoint));
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return false;
  const host = url.hostname.toLowerCase();
  return host === "fcm.googleapis.com"
    || host === "web.push.apple.com" || host.endsWith(".push.apple.com")
    || host.endsWith(".push.services.mozilla.com")
    || host.endsWith(".notify.windows.com");
}

export function isValidSubscriptionKeys(p256dh, auth) {
  try {
    const publicKey = base64UrlDecode(p256dh);
    const secret = base64UrlDecode(auth);
    return publicKey.length === 65 && publicKey[0] === 4 && secret.length === 16;
  } catch {
    return false;
  }
}

export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: base64UrlEncode(ecdh.getPublicKey()), privateKey: base64UrlEncode(ecdh.getPrivateKey()) };
}

/**
 * Reads VAPID keys from the environment; returns null when push is not configured.
 * @param {Record<string, string | undefined>} [env]
 */
export function readVapidConfig(env = process.env) {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  const publicBytes = base64UrlDecode(publicKey);
  const privateBytes = base64UrlDecode(privateKey);
  if (publicBytes.length !== 65 || publicBytes[0] !== 4 || privateBytes.length !== 32) return null;
  const subject = env.VAPID_SUBJECT?.trim() || "https://tyuttori.ru";
  const key = createPrivateKey({
    format: "jwk",
    key: {
      kty: "EC",
      crv: "P-256",
      d: base64UrlEncode(privateBytes),
      x: base64UrlEncode(publicBytes.subarray(1, 33)),
      y: base64UrlEncode(publicBytes.subarray(33, 65)),
    },
  });
  return { publicKey, key, subject };
}

export function vapidAuthorization(endpoint, vapid, now = Date.now()) {
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = base64UrlEncode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: vapid.subject,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: vapid.key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${unsigned}.${base64UrlEncode(signature)}, k=${vapid.publicKey}`;
}

function hmac(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

/** Encrypts one push message for a subscription (single aes128gcm record). */
export function encryptPushPayload(payload, p256dh, auth, { salt = randomBytes(16), serverKeys } = {}) {
  const userPublicKey = base64UrlDecode(p256dh);
  const authSecret = base64UrlDecode(auth);
  const ecdh = serverKeys ?? createECDH("prime256v1");
  if (!serverKeys) ecdh.generateKeys();
  const serverPublicKey = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userPublicKey);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), userPublicKey, serverPublicKey]);
  const ikm = hmac(hmac(authSecret, sharedSecret), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const contentKey = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  const plaintext = Buffer.concat([Buffer.from(payload), Buffer.from([2])]);
  if (plaintext.length + 16 > RECORD_SIZE) throw new Error("push payload too large");
  const cipher = createCipheriv("aes-128-gcm", contentKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(serverPublicKey.length, 20);
  return Buffer.concat([header, serverPublicKey, ciphertext]);
}

/**
 * Sends one push message. Result `outcome`:
 * ok — accepted; gone — subscription expired (404/410), delete it;
 * retry — temporary failure; failed — permanent failure for this message.
 */
export async function sendWebPush(subscription, payload, vapid, { ttl = 24 * 60 * 60, urgency = "normal" } = {}) {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return { outcome: "gone", reason: "endpoint_not_allowed" };
  let body;
  try {
    body = encryptPushPayload(JSON.stringify(payload), subscription.p256dh, subscription.auth);
  } catch {
    return { outcome: "gone", reason: "invalid_keys" };
  }
  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        authorization: vapidAuthorization(subscription.endpoint, vapid),
        "content-encoding": "aes128gcm",
        "content-type": "application/octet-stream",
        ttl: String(ttl),
        urgency,
      },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.arrayBuffer().catch(() => undefined);
    if (response.status >= 200 && response.status < 300) return { outcome: "ok" };
    const reason = `http_${response.status}`;
    if (response.status === 404 || response.status === 410) return { outcome: "gone", reason };
    if (response.status === 429 || response.status >= 500) return { outcome: "retry", reason };
    return { outcome: "failed", reason };
  } catch (error) {
    return { outcome: "retry", reason: error instanceof Error ? error.name.slice(0, 80) : "network_error" };
  }
}
