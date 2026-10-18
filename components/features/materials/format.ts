import type { TeacherMaterial } from "@/components/features/app/types";

export const formatBytes = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} МБ` : `${Math.max(0, Math.round(bytes / 1024))} КБ`;

export const materialTags = (value: string) => value.split(",").map((tag) => tag.trim().replace(/^#+/, "")).filter(Boolean).filter((tag, index, tags) => tags.findIndex((candidate) => candidate.toLocaleLowerCase("ru-RU") === tag.toLocaleLowerCase("ru-RU")) === index).slice(0, 10);

export const isPdfMaterial = (resource: TeacherMaterial) => resource.contentType === "application/pdf";
export const isImageMaterial = (resource: TeacherMaterial) => resource.contentType.startsWith("image/");
export const isWordMaterial = (resource: TeacherMaterial) => resource.contentType === "application/msword" || resource.contentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const materialTypeLabel = (resource: TeacherMaterial) => isImageMaterial(resource) ? "Изображение" : isPdfMaterial(resource) ? "PDF" : "Word";
