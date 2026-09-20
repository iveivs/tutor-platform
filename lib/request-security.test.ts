import { describe, expect, it } from "vitest";
import { readLimitedJson } from "./request-security";

describe("readLimitedJson", () => {
  it("accepts a valid JSON body", async () => {
    const result = await readLimitedJson<{ value: string }>(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "ok" }),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ value: "ok" });
  });

  it("rejects an oversized declared body", async () => {
    const result = await readLimitedJson(new Request("https://example.test", {
      method: "POST",
      headers: { "content-length": String(16 * 1024 + 1) },
      body: "{}",
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("measures the actual UTF-8 byte length", async () => {
    const result = await readLimitedJson(new Request("https://example.test", {
      method: "POST",
      body: JSON.stringify({ value: "🙂".repeat(5000) }),
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
  });

  it("rejects malformed JSON", async () => {
    const result = await readLimitedJson(new Request("https://example.test", {
      method: "POST",
      body: "{",
    }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
  });
});
