import { describe, expect, it } from "vitest";
import { mp3Bitrate, targetBitrate } from "../scripts/audio-compress.mjs";

describe("audio compression", () => {
  it("reads the bitrate of the first MPEG frame, after an ID3 tag", () => {
    expect(mp3Bitrate(new Uint8Array([0xff, 0xfb, 0xe0, 0x64]))).toBe(320);
    expect(mp3Bitrate(new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 2, 0, 0, 0xff, 0xfb, 0x90, 0x64]))).toBe(128);
    expect(mp3Bitrate(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBeNull();
  });

  it("re-encodes only files above the limit", () => {
    expect(targetBitrate(320, false)).toBe(160);
    expect(targetBitrate(192, false)).toBeNull();
    expect(targetBitrate(192, true)).toBe(128);
    expect(targetBitrate(128, true)).toBeNull();
  });
});
