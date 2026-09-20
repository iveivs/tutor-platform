export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join("; ");

export const SECURITY_HEADERS = [
  ["Content-Security-Policy", CONTENT_SECURITY_POLICY],
  ["X-Content-Type-Options", "nosniff"],
  ["X-Frame-Options", "DENY"],
  ["Referrer-Policy", "strict-origin-when-cross-origin"],
  ["Permissions-Policy", "camera=(), microphone=(), geolocation=()"],
  ["Cross-Origin-Opener-Policy", "same-origin"],
] as const;

export function applySecurityHeaders(response: Response, request: Request) {
  const headers = new Headers(response.headers);
  for (const [name, value] of SECURITY_HEADERS) headers.set(name, value);
  if (new URL(request.url).protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
