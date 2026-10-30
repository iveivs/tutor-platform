// Re-encodes MP3 files whose bitrate is higher than needed for lessons, to save storage and traffic.
// Uses the small `lame` encoder (installed in the Docker image); the original is replaced only when
// the result is smaller. Teacher library tracks go down to 160 kbps, student recordings to 128 kbps.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];

/** Bitrate (kbps) from the first MPEG audio frame header, skipping an ID3v2 tag; null if not found. */
export function mp3Bitrate(bytes) {
  let offset = 0;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33 && bytes.length > 10) {
    offset = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
  }
  for (let i = offset; i < Math.min(bytes.length - 2, offset + 64 * 1024); i += 1) {
    if (bytes[i] !== 0xff || (bytes[i + 1] & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1] >> 3) & 0x03;
    const layer = (bytes[i + 1] >> 1) & 0x03;
    const index = (bytes[i + 2] >> 4) & 0x0f;
    if (layer !== 0x01 || version === 0x01 || index === 0 || index === 15) continue;
    return (version === 0x03 ? BITRATES_V1_L3 : BITRATES_V2_L3)[index];
  }
  return null;
}

/** Target bitrate for a file, or null when it is already small enough. */
export function targetBitrate(bitrate, studentFile) {
  const target = studentFile ? 128 : 160;
  const threshold = studentFile ? 128 : 192;
  return bitrate && bitrate > threshold ? target : null;
}

function runLame(input, output, kbps) {
  return new Promise((resolve, reject) => {
    const child = spawn("lame", ["--quiet", "--mp3input", "-b", String(kbps), input, output], { stdio: "ignore" });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("lame timeout")); }, 120_000);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`lame exit ${code}`)); });
  });
}

async function compressOne(storage, objectKey, studentFile) {
  const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
  const bytes = await object.Body.transformToByteArray();
  const kbps = targetBitrate(mp3Bitrate(bytes), studentFile);
  if (!kbps) return null;
  const dir = await mkdtemp(join(tmpdir(), "tyuttori-audio-"));
  try {
    await writeFile(join(dir, "in.mp3"), bytes);
    await runLame(join(dir, "in.mp3"), join(dir, "out.mp3"), kbps);
    const result = await readFile(join(dir, "out.mp3"));
    if (result.byteLength >= bytes.byteLength) return null;
    await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: result, ContentType: "audio/mpeg", CacheControl: "private, no-store" }));
    return result.byteLength;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A few unchecked MP3 files per worker cycle; each file is checked once. */
export async function compressAudio(client, storage) {
  if (!storage) return;
  const due = await client.query(`(SELECT 'teacher_resources' AS source, id, object_key, false AS student FROM teacher_resources
      WHERE content_type = 'audio/mpeg' AND status = 'active' AND audio_checked_at IS NULL LIMIT 5)
    UNION ALL (SELECT 'lesson_files', file.id, file.object_key, uploader.role = 'student' FROM lesson_files file
      LEFT JOIN members uploader ON uploader.id = file.uploaded_by_member_id
      WHERE file.content_type = 'audio/mpeg' AND file.status = 'active' AND file.audio_checked_at IS NULL LIMIT 5)`);
  for (const row of due.rows) {
    let size = null;
    try { size = await compressOne(storage, String(row.object_key), Boolean(row.student)); }
    catch (error) { console.error(JSON.stringify({ event: "audio_compress_failed", reason: error instanceof Error ? error.message.slice(0, 120) : "unknown" })); }
    const table = row.source === "teacher_resources" ? "teacher_resources" : "lesson_files";
    await client.query(`UPDATE ${table} SET audio_checked_at = now()${size ? ", byte_size = $2" : ""} WHERE id = $1`, size ? [row.id, size] : [row.id]);
  }
}
