// Runs once when the server starts (Next.js instrumentation). Only the Node runtime counts
// requests for the admin's platform statistics.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installRequestMetrics } = await import("./lib/request-metrics");
  installRequestMetrics();
}
