import { describe, expect, it } from "vitest";
import { applySecurityHeaders, CONTENT_SECURITY_POLICY } from "./security-headers";

describe("applySecurityHeaders", () => {
  it("adds CSP and the standard security headers", () => {
    const response = applySecurityHeaders(new Response("ok"), new Request("https://example.test"));

    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("does not advertise HSTS over local HTTP", () => {
    const response = applySecurityHeaders(new Response("ok"), new Request("http://127.0.0.1:8787"));

    expect(response.headers.has("strict-transport-security")).toBe(false);
  });
});
