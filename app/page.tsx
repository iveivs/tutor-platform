import { AuthGate } from "@/components/auth-gate";

export default function HomePage() {
  return <AuthGate enabled={Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY)} />;
}
