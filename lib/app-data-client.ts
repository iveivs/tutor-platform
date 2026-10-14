import type { AppData } from "@/components/features/app/types";
import { appFetch } from "@/lib/client-fetch";

export async function readAppData(includePastLessons = false, cursor?: number): Promise<AppData> {
  const params = new URLSearchParams();
  if (includePastLessons) params.set("includePastLessons", "1");
  if (cursor !== undefined) params.set("cursor", String(cursor));

  const response = await appFetch(`/api/app-data${params.size ? `?${params}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Не удалось загрузить данные");
  return response.json() as Promise<AppData>;
}

export async function saveAppData(body: Record<string, unknown>) {
  const response = await appFetch("/api/app-data", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json() as { error?: string; inviteUrl?: string; expired?: boolean };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить изменения");
  return result;
}
