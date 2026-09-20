const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export function isLocalDemoModeEnabled(host: string | null, enabled = process.env.ALLOW_INSECURE_DEMO_MODE) {
  if (enabled !== "true" || !host) return false;

  const normalizedHost = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":", 1)[0];

  return LOCAL_HOSTS.has(normalizedHost.toLowerCase());
}

export function isLocalDemoRequest(request: Request | undefined, enabled = process.env.ALLOW_INSECURE_DEMO_MODE) {
  return Boolean(request && isLocalDemoModeEnabled(new URL(request.url).hostname, enabled));
}
