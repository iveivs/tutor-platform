type AuthConfig = { url: string; publishableKey: string };

export async function requestPasswordRecovery(config: AuthConfig, email: string, redirectTo: string) {
  const response = await fetch(`${config.url}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: { apikey: config.publishableKey, "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  return response.ok;
}

export async function updatePassword(config: AuthConfig, accessToken: string, password: string) {
  const response = await fetch(`${config.url}/auth/v1/user`, {
    method: "PUT",
    headers: {
      apikey: config.publishableKey,
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ password }),
  });
  return response.ok;
}
