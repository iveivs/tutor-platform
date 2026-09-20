import { AuthGate } from "@/components/auth-gate";
import { isLocalDemoModeEnabled } from "@/lib/demo-mode";
import { headers } from "next/headers";

export default async function HomePage() {
  const requestHeaders = await headers();
  const authConfigured = Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY));
  const localDemoEnabled = isLocalDemoModeEnabled(requestHeaders.get("host"));
  return <AuthGate enabled={authConfigured || !localDemoEnabled} />;
}
