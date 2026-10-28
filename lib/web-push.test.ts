import { createDecipheriv, createECDH, createHmac, createPublicKey, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  base64UrlDecode,
  base64UrlEncode,
  encryptPushPayload,
  generateVapidKeys,
  isAllowedPushEndpoint,
  isValidSubscriptionKeys,
  readVapidConfig,
  vapidAuthorization,
} from "../scripts/web-push.mjs";

const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

// Browser side of RFC 8291, used to prove the worker's payload decrypts.
function decrypt(body: Buffer, userKeys: ReturnType<typeof createECDH>, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverPublicKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const sharedSecret = userKeys.computeSecret(serverPublicKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), userKeys.getPublicKey(), serverPublicKey]);
  const ikm = hmac(hmac(authSecret, sharedSecret), Buffer.concat([keyInfo, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const contentKey = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
  const decipher = createDecipheriv("aes-128-gcm", contentKey, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  expect(plain[plain.length - 1]).toBe(2);
  return plain.subarray(0, plain.length - 1).toString();
}

describe("web push", () => {
  it("encrypts a payload the subscriber can decrypt", () => {
    const userKeys = createECDH("prime256v1");
    userKeys.generateKeys();
    const authSecret = Buffer.from("0123456789abcdef");
    const payload = JSON.stringify({ title: "Новое сообщение", body: "Откройте Тьюттори", badge: 3 });
    const body = encryptPushPayload(payload, base64UrlEncode(userKeys.getPublicKey()), base64UrlEncode(authSecret));
    expect(body.readUInt32BE(16)).toBe(4096);
    expect(decrypt(body, userKeys, authSecret)).toBe(payload);
  });

  it("signs a VAPID token the push service can verify", () => {
    const keys = generateVapidKeys();
    const vapid = readVapidConfig({ VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "https://tyuttori.ru" });
    expect(vapid).not.toBeNull();
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", vapid!, Date.UTC(2026, 9, 28));
    const [, token, publicKey] = /^vapid t=([^,]+), k=(.+)$/.exec(header) ?? [];
    expect(publicKey).toBe(keys.publicKey);
    const [encodedHeader, encodedClaims, signature] = token.split(".");
    expect(JSON.parse(base64UrlDecode(encodedClaims).toString())).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://tyuttori.ru" });
    const raw = base64UrlDecode(keys.publicKey);
    const verifier = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: base64UrlEncode(raw.subarray(1, 33)), y: base64UrlEncode(raw.subarray(33)) } });
    expect(verify("sha256", Buffer.from(`${encodedHeader}.${encodedClaims}`), { key: verifier, dsaEncoding: "ieee-p1363" }, base64UrlDecode(signature))).toBe(true);
  });

  it("is off without complete keys", () => {
    expect(readVapidConfig({})).toBeNull();
    expect(readVapidConfig({ VAPID_PUBLIC_KEY: generateVapidKeys().publicKey })).toBeNull();
  });

  it("accepts only known push services", () => {
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isAllowedPushEndpoint("https://web.push.apple.com/QF1")).toBe(true);
    expect(isAllowedPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(isAllowedPushEndpoint("https://wns2-am3p.notify.windows.com/w/?token=x")).toBe(true);
    expect(isAllowedPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://127.0.0.1/x")).toBe(false);
    expect(isAllowedPushEndpoint("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(isAllowedPushEndpoint("not a url")).toBe(false);
  });

  it("checks subscription key sizes", () => {
    const userKeys = createECDH("prime256v1");
    userKeys.generateKeys();
    expect(isValidSubscriptionKeys(base64UrlEncode(userKeys.getPublicKey()), base64UrlEncode(Buffer.alloc(16)))).toBe(true);
    expect(isValidSubscriptionKeys(base64UrlEncode(Buffer.alloc(10)), base64UrlEncode(Buffer.alloc(16)))).toBe(false);
  });
});
