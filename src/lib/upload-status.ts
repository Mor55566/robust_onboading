import { sql } from "@/lib/db";
import { residentSql } from "@/lib/resident-db";
import { usersSql } from "@/lib/users-db";
import {
  emptyUploadStatus,
  INTERNAL_EMAIL_DOMAINS,
  type UploadStatus,
} from "@/lib/upload-status-keys";

const NON_INTERNAL_EMAIL_PATTERN = `@(${INTERNAL_EMAIL_DOMAINS.join("|")})\\.`;

export async function getUploadStatus(complexId: string): Promise<UploadStatus> {
  if (!complexId) return emptyUploadStatus();

  const [mainRows, residentRows, userRows] = await Promise.all([
    sql`
      SELECT
        EXISTS (
          SELECT 1 FROM floors f
          JOIN buildings b ON b.id = f.building_id
          WHERE b.complex_id = ${complexId}
        ) AS floors,
        EXISTS (
          SELECT 1 FROM areas a
          JOIN buildings b ON b.id = a.building_id
          WHERE b.complex_id = ${complexId}
        ) AS areas,
        EXISTS (
          SELECT 1 FROM equipment e
          JOIN buildings b ON b.id = e.building_id
          WHERE b.complex_id = ${complexId}
        ) AS equipment,
        EXISTS (
          SELECT 1 FROM task_categories
          WHERE complex_id = ${complexId}
        ) AS categories,
        EXISTS (
          SELECT 1 FROM file_tags
          WHERE complex_id = ${complexId}
        ) AS file_tags,
        EXISTS (
          SELECT 1 FROM files fl
          JOIN file_series fs ON fs.id = fl.series_id
          WHERE fs.complex_id = ${complexId}
        ) AS files,
        EXISTS (
          SELECT 1 FROM file_attachments fa
          JOIN files fl ON fl.id = fa.file_id
          JOIN file_series fs ON fs.id = fl.series_id
          WHERE fs.complex_id = ${complexId}
        ) AS file_attachments,
        EXISTS (
          SELECT 1 FROM tasks t
          JOIN buildings b ON b.id = t.building_id
          WHERE b.complex_id = ${complexId} AND t.type = 'template-mission'
        ) AS scheduled_missions,
        EXISTS (
          SELECT 1 FROM tasks t
          JOIN buildings b ON b.id = t.building_id
          WHERE b.complex_id = ${complexId} AND t.type = 'mission'
        ) AS mission_history,
        EXISTS (
          SELECT 1 FROM tasks t
          JOIN buildings b ON b.id = t.building_id
          WHERE b.complex_id = ${complexId} AND t.type = 'task'
        ) AS tasks,
        EXISTS (
          SELECT 1 FROM automation_rules
          WHERE complex_id = ${complexId}
        ) AS automations
    `,
    residentSql`
      SELECT EXISTS (
        SELECT 1 FROM residents WHERE complex_id = ${complexId}
      ) AS residents
    `,
    usersSql`
      SELECT EXISTS (
        SELECT 1 FROM user_complex_permissions ucp
        JOIN users u ON u.id = ucp.user_id
        WHERE ucp.complex_id = ${complexId}
          AND u.email !~* ${NON_INTERNAL_EMAIL_PATTERN}
      ) AS users
    `,
  ]);

  const main = mainRows[0] as Record<string, boolean> | undefined;
  const resident = residentRows[0] as { residents: boolean } | undefined;
  const user = userRows[0] as { users: boolean } | undefined;

  return {
    floors: Boolean(main?.floors),
    areas: Boolean(main?.areas),
    equipment: Boolean(main?.equipment),
    categories: Boolean(main?.categories),
    fileTags: Boolean(main?.file_tags),
    files: Boolean(main?.files),
    fileAttachments: Boolean(main?.file_attachments),
    residents: Boolean(resident?.residents),
    scheduledMissions: Boolean(main?.scheduled_missions),
    missionHistory: Boolean(main?.mission_history),
    users: Boolean(user?.users),
    tasks: Boolean(main?.tasks),
    automations: Boolean(main?.automations),
  };
}
