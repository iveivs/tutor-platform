type AuthConfig = { url: string; publishableKey: string };

export type TeacherSignupResult =
  | { ok: true; deliverable: true; authSubject: string }
  | { ok: true; deliverable: false }
  | { ok: false; reason: "configuration" | "rate_limit" | "service" };

/** Requests a confirmation email without exposing whether an account already exists. */
export async function requestTeacherSignup(
  config: AuthConfig,
  input: { email: string; password: string; displayName: string; redirectTo: string },
): Promise<TeacherSignupResult> {
  const endpoint = new URL(`${config.url}/auth/v1/signup`);
  endpoint.searchParams.set("redirect_to", input.redirectTo);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { apikey: config.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email: input.email, password: input.password, data: { full_name: input.displayName, account_type: "teacher" } }),
  });
  const result = await response.json().catch(() => ({})) as {
    id?: string;
    identities?: unknown[];
    user?: { id?: string; identities?: unknown[] };
    session?: unknown;
    access_token?: string;
  };

  if (response.status === 429) return { ok: false, reason: "rate_limit" };
  if (!response.ok) return { ok: false, reason: "service" };
  // An access token at signup means Confirm Email is disabled. Provisioning must fail closed.
  if (result.session || result.access_token) return { ok: false, reason: "configuration" };

  const user = result.user ?? result;
  if (!user.id) return { ok: false, reason: "service" };
  // Supabase returns an obfuscated user with no identities for an existing confirmed email.
  if (Array.isArray(user.identities) && user.identities.length === 0) return { ok: true, deliverable: false };
  return { ok: true, deliverable: true, authSubject: user.id };
}
