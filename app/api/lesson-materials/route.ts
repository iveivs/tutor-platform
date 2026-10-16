import { readLessonMaterials } from "@/lib/lesson-content/read-handler";
import { updateLessonMaterials } from "@/lib/lesson-content/write-handler";

export const runtime = "nodejs";

export const GET = readLessonMaterials;
export const POST = updateLessonMaterials;
