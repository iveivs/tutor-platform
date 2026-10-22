import { describe, expect, it } from "vitest";
import { parseHttpByteRange } from "./http-byte-range";

describe("parseHttpByteRange", () => {
  it("parses bounded, open, and suffix byte ranges", () => {
    expect(parseHttpByteRange("bytes=0-99", 1_000)).toEqual({ start: 0, end: 99 });
    expect(parseHttpByteRange("bytes=900-", 1_000)).toEqual({ start: 900, end: 999 });
    expect(parseHttpByteRange("bytes=-100", 1_000)).toEqual({ start: 900, end: 999 });
  });

  it("caps the end and rejects unsupported or unsatisfiable ranges", () => {
    expect(parseHttpByteRange("bytes=950-1200", 1_000)).toEqual({ start: 950, end: 999 });
    expect(parseHttpByteRange("bytes=0-1,10-11", 1_000)).toBe("invalid");
    expect(parseHttpByteRange("bytes=1000-", 1_000)).toBe("invalid");
  });

  it("returns null when no range was requested", () => {
    expect(parseHttpByteRange(null, 1_000)).toBeNull();
  });
});
