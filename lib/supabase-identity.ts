type AuthConfig = { url: string; publishableKey: string; secretKey?: string };
export type SupabaseIdentity = { id: string; email?: string };

export async function signInExistingIdentity(config: AuthConfig, email: string, password: string): Promise<SupabaseIdentity | null> {
  const response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json() as { user?: SupabaseIdentity };
  return response.ok && result.user?.id ? result.user : null;
}

export async function createIdentity(config: AuthConfig, email: string, password: string, name: string) {
  if (!config.secretKey) return { ok: false as const, existing: false };
  const response = await fetch(`${config.url}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: config.secretKey, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: name } }),
  });
  const result = await response.json() as { id?: string; email?: string; code?: string; msg?: string; message?: string };
  if (response.ok && result.id) return { ok: true as const, identity: { id: result.id, email: result.email } };
  const errorText = `${result.code ?? ""} ${result.msg ?? ""} ${result.message ?? ""}`.toLowerCase();
  return { ok: false as const, existing: response.status === 422 || errorText.includes("already") || errorText.includes("exists") };
}
