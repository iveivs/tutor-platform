/**
 * Build-time compatibility for the standard Node target.
 *
 * The Cloudflare build ignores this Next.js alias and receives real bindings.
 * Node routes must be moved to PostgreSQL before the VPS target is considered
 * runnable; an accidental D1 call therefore remains fail-closed.
 */
export const env: Record<string, undefined> = Object.freeze({});

