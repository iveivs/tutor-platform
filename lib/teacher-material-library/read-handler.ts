import { getPostgresPool } from "@/db/postgres";
import { hasCurrentContentRulesAcceptance, lessonPhotoStorageConfigured } from "@/lib/lesson-materials";
import {
  MAX_TEACHER_MATERIAL_BYTES,
  MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH,
  MAX_WORKSPACE_MATERIAL_BYTES,
} from "@/lib/teacher-material-files";
import { materialPayload, readUsage, requireTeacher } from "@/lib/teacher-material-library/shared";

export async function readTeacherMaterials(request: Request) {
  try {
    const auth = await requireTeacher(request);
    if (auth instanceof Response) return auth;
    const [accepted, resources, usage] = await Promise.all([
      hasCurrentContentRulesAcceptance(auth),
      getPostgresPool().query(`SELECT resource.id, resource.title, resource.original_filename, resource.content_type,
          resource.byte_size, resource.folder, resource.tags, resource.version_number, resource.last_used_at,
          resource.created_at, resource.updated_at,
          COALESCE((SELECT json_agg(json_build_object(
            'lessonId', link.lesson_id, 'studentId', lesson.student_id,
            'studentName', student.display_name, 'startsAt', lesson.starts_at
          ) ORDER BY lesson.starts_at DESC)
          FROM lesson_resource_links link
          JOIN lessons lesson ON lesson.id = link.lesson_id AND lesson.workspace_id = resource.workspace_id
          JOIN members student ON student.id = lesson.student_id
          WHERE link.resource_id = resource.id), '[]'::json) AS assignments
        FROM teacher_resources resource
        WHERE resource.workspace_id = $1 AND resource.status = 'active'
        ORDER BY COALESCE(resource.last_used_at, resource.created_at) DESC`, [auth.workspaceId]),
      readUsage(getPostgresPool(), auth.workspaceId),
    ]);
    return Response.json({
      contentRulesAccepted: accepted,
      storageConfigured: lessonPhotoStorageConfigured(),
      maxFileBytes: MAX_TEACHER_MATERIAL_BYTES,
      maxUploadsPerMonth: MAX_TEACHER_MATERIAL_UPLOADS_PER_MONTH,
      maxStorageBytes: MAX_WORKSPACE_MATERIAL_BYTES,
      uploadsThisMonth: Number(usage.rows[0]?.uploads_this_month ?? 0),
      storageBytes: Number(usage.rows[0]?.storage_bytes ?? 0),
      resources: resources.rows.map(materialPayload),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to read teacher materials", error);
    return Response.json({ error: "Не удалось загрузить библиотеку" }, { status: 500 });
  }
}
