import http from "node:http";
import { getPostgresPool } from "@/db/postgres";

// Counts every HTTP request the Node server answers, without URLs, ids or users: per kind
// (page, api, file download, live connection) the number, errors, response-time buckets and
// bytes sent. Totals go to platform_request_stats once a minute, one row per hour and kind.

type Kind = "page" | "api" | "file" | "realtime";
type Counter = { requests: number; errors: number; totalMs: number; buckets: number[]; bytes: number };

// Upper bounds in ms of the response-time buckets; the last bucket is everything slower.
const BUCKETS_MS = [100, 300, 1000, 3000];
const FILE_TYPE = /^(application\/(pdf|octet-stream|msword|vnd\.openxmlformats)|image\/|audio\/)/;

let counters = new Map<Kind, Counter>();
let openRealtime = 0;
let peakRealtime = 0;

function counter(kind: Kind) {
  let value = counters.get(kind);
  if (!value) { value = { requests: 0, errors: 0, totalMs: 0, buckets: [0, 0, 0, 0, 0], bytes: 0 }; counters.set(kind, value); }
  return value;
}

function kindOf(url: string, contentType: string): Kind | null {
  if (url.startsWith("/_next/") || url.startsWith("/favicon") || /\.(png|svg|ico|webmanifest|js|css|woff2?)(\?|$)/.test(url)) return null;
  if (url.startsWith("/api/realtime")) return "realtime";
  if (FILE_TYPE.test(contentType)) return "file";
  return url.startsWith("/api/") ? "api" : "page";
}

function track(request: http.IncomingMessage, response: http.ServerResponse) {
  const started = performance.now();
  const url = request.url ?? "/";
  const live = url.startsWith("/api/realtime");
  if (live) { openRealtime += 1; peakRealtime = Math.max(peakRealtime, openRealtime); }
  let bytes = 0;
  const write = response.write.bind(response) as (...args: unknown[]) => boolean;
  const end = response.end.bind(response) as (...args: unknown[]) => http.ServerResponse;
  const count = (chunk: unknown) => { if (typeof chunk === "string") bytes += Buffer.byteLength(chunk); else if (chunk instanceof Uint8Array) bytes += chunk.byteLength; };
  response.write = ((chunk: unknown, ...rest: unknown[]) => { count(chunk); return write(chunk, ...rest); }) as typeof response.write;
  response.end = ((chunk?: unknown, ...rest: unknown[]) => { if (chunk && typeof chunk !== "function") count(chunk); return end(chunk, ...rest); }) as typeof response.end;
  response.once("close", () => {
    if (live) openRealtime = Math.max(0, openRealtime - 1);
    const kind = kindOf(url, String(response.getHeader("content-type") ?? ""));
    if (!kind) return;
    const value = counter(kind);
    const ms = performance.now() - started;
    value.requests += 1;
    if (response.statusCode >= 500) value.errors += 1;
    // A live connection stays open for minutes; its duration says nothing about speed.
    if (kind !== "realtime") {
      const bucket = BUCKETS_MS.findIndex((limit) => ms < limit);
      value.totalMs += ms;
      value.buckets[bucket === -1 ? BUCKETS_MS.length : bucket] += 1;
    }
    value.bytes += bytes;
  });
}

async function flush() {
  const current = counters;
  counters = new Map();
  const peak = peakRealtime;
  peakRealtime = openRealtime;
  if (!current.size && !peak) return;
  if (peak && !current.has("realtime")) current.set("realtime", { requests: 0, errors: 0, totalMs: 0, buckets: [0, 0, 0, 0, 0], bytes: 0 });
  const pool = getPostgresPool();
  for (const [kind, value] of current) {
    await pool.query(`INSERT INTO platform_request_stats (hour, kind, requests, errors, total_ms, buckets, bytes, peak_open)
      VALUES (date_trunc('hour', now()), $1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (hour, kind) DO UPDATE SET requests = platform_request_stats.requests + EXCLUDED.requests,
        errors = platform_request_stats.errors + EXCLUDED.errors, total_ms = platform_request_stats.total_ms + EXCLUDED.total_ms,
        buckets = ARRAY(SELECT a + b FROM unnest(platform_request_stats.buckets, EXCLUDED.buckets) AS t(a, b)),
        bytes = platform_request_stats.bytes + EXCLUDED.bytes, peak_open = GREATEST(platform_request_stats.peak_open, EXCLUDED.peak_open)`,
    [kind, value.requests, value.errors, Math.round(value.totalMs), value.buckets, value.bytes, kind === "realtime" ? peak : 0]);
  }
}

let installed = false;

/** Called once from instrumentation.ts in the Node runtime. */
export function installRequestMetrics() {
  if (installed || !process.env.DATABASE_URL) return;
  installed = true;
  const emit = http.Server.prototype.emit;
  http.Server.prototype.emit = function patchedEmit(this: http.Server, event: string, ...args: unknown[]) {
    if (event === "request") {
      try { track(args[0] as http.IncomingMessage, args[1] as http.ServerResponse); } catch { /* Metrics never break a request. */ }
    }
    return (emit as (...values: unknown[]) => boolean).apply(this, [event, ...args]);
  } as typeof http.Server.prototype.emit;
  setInterval(() => { void flush().catch(() => undefined); }, 60_000).unref();
}
