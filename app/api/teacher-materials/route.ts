import { readTeacherMaterials } from "@/lib/teacher-material-library/read-handler";
import { deleteTeacherMaterialRecord } from "@/lib/teacher-material-library/handlers/delete";
import { replaceTeacherMaterial } from "@/lib/teacher-material-library/handlers/replace";
import { updateTeacherMaterialMetadata } from "@/lib/teacher-material-library/handlers/update-metadata";
import { uploadTeacherMaterial } from "@/lib/teacher-material-library/handlers/upload";

export const runtime = "nodejs";

export const GET = readTeacherMaterials;
export const POST = uploadTeacherMaterial;
export const PATCH = updateTeacherMaterialMetadata;
export const PUT = replaceTeacherMaterial;
export const DELETE = deleteTeacherMaterialRecord;
