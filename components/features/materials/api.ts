import type { LessonMaterialsData, TeacherMaterialsData } from "@/components/features/app/types";
import { appFetch } from "@/lib/client-fetch";

export async function readLessonMaterials(lessonId: string) {
  const response = await appFetch(`/api/lesson-materials?lessonId=${encodeURIComponent(lessonId)}`, { cache: "no-store" });
  const result = await response.json() as LessonMaterialsData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить материалы урока");
  return result;
}

export async function saveLessonMaterial(body: Record<string, unknown>) {
  const response = await appFetch("/api/lesson-materials", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить материалы урока");
}

export async function readTeacherMaterials() {
  const response = await appFetch("/api/teacher-materials", { cache: "no-store" });
  const result = await response.json() as TeacherMaterialsData & { error?: string };
  if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить библиотеку");
  return result;
}
