"use server";

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { usersSql } from "@/lib/users-db";
import { getDictionary } from "@/i18n/get-dictionary";
import { t } from "@/i18n/t";
import type { AreaImportFloor, EquipmentLocationArea } from "@/lib/area-import";
import {
  normalizeLookup,
  resolveTaskImportRows,
  type TaskImportRow,
} from "@/lib/task-import";
import {
  scheduledCallScheduleFromImport,
  type CallScheduleColumns,
  type ScheduledCallImportRow,
} from "@/lib/scheduled-call-import";

/**
 * Scheduled calls import (template-call + mission_schedules, see
 * src/lib/scheduled-call-import.ts). Rows are matched to this complex's
 * scheduled calls by Visitt's id (tasks.external_id), so a re-upload updates
 * them instead of creating duplicates.
 */

type ResolvedRow = {
  rowNumber: number;
  externalId: string | null;
  description: string;
  buildingId: string;
  floorId: string | null;
  areaId: string | null;
  categoryName: string | null;
  openedByUserId: string;
  openedByName: string | null;
  assigneeIds: string[];
  /** File names that matched no user of the complex. */
  unknownAssignees: string[];
  schedule: CallScheduleColumns;
  createdAt: string | null;
  anchorAt: string | null;
};

type RowFailure = { rowNumber: number; externalId: string | null; error: string };

async function resolveComplexId(complexId: unknown): Promise<string | null> {
  const parsed = z.string().uuid().safeParse(complexId);
  if (!parsed.success) return null;
  const rows = await sql`SELECT id FROM complexes WHERE id = ${parsed.data} LIMIT 1`;
  return rows.length > 0 ? parsed.data : null;
}

/** "שטח משותף > מינוס 3 / חניון" -> "שטח משותף": the building the path starts at. */
function locationBuildingHint(location: string): string {
  return location.split(/\s*[>/<]\s*/)[0]?.trim() ?? "";
}

async function resolveRows(
  complexId: string,
  rows: ScheduledCallImportRow[],
  fallbackOpenedByUserId: string,
  dict: Awaited<ReturnType<typeof getDictionary>>,
): Promise<{ resolved: ResolvedRow[]; failures: RowFailure[]; categoryNamesToCreate: string[] }> {
  const [buildings, floors, areas, complexUsers, categories] = await Promise.all([
    sql`SELECT id, name FROM buildings WHERE complex_id = ${complexId} AND is_hidden = false ORDER BY name ASC`,
    sql`
      SELECT id, name, number, building_id FROM floors
      WHERE building_id IN (SELECT id FROM buildings WHERE complex_id = ${complexId})
        AND is_hidden = false
    `,
    sql`
      SELECT id, name, floor_id, parent_area_id, building_id FROM areas
      WHERE building_id IN (SELECT id FROM buildings WHERE complex_id = ${complexId})
        AND is_hidden = false
    `,
    usersSql`
      SELECT u.id, u.full_name
      FROM users u
      INNER JOIN user_complex_permissions ucp ON ucp.user_id = u.id
      WHERE ucp.complex_id = ${complexId}
    `,
    sql`SELECT id, name FROM task_categories WHERE complex_id = ${complexId}`,
  ]);

  const floorsByBuilding = new Map<string, AreaImportFloor[]>();
  for (const row of floors) {
    const list = floorsByBuilding.get(row.building_id as string) ?? [];
    list.push({ id: row.id as string, name: row.name as string, number: Number(row.number) });
    floorsByBuilding.set(row.building_id as string, list);
  }
  const areasByBuilding = new Map<string, EquipmentLocationArea[]>();
  for (const row of areas) {
    const list = areasByBuilding.get(row.building_id as string) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      parent_area_id: (row.parent_area_id as string | null) ?? null,
    });
    areasByBuilding.set(row.building_id as string, list);
  }
  // Users belong to the complex, not a building: offer each one in every building.
  const users = buildings.flatMap((building) =>
    complexUsers.map((user) => ({
      id: user.id as string,
      full_name: user.full_name as string,
      building_id: building.id as string,
    })),
  );
  const userNames = new Set(complexUsers.map((user) => normalizeLookup(user.full_name as string)));

  // The calls import resolves location, category and people the same way.
  const asTaskRows: TaskImportRow[] = rows.map((row) => ({
    rowNumber: row.rowNumber,
    description: row.description,
    urgency: "medium",
    status: "open",
    createdAt: row.createdAt,
    dueAt: null,
    building: locationBuildingHint(row.location),
    location: row.location,
    category: row.category,
    subcategory: "",
    callNumber: "",
    reporter: row.createdBy,
    assignees: row.assignees,
    imageUrls: [],
    resolutionImageUrls: [],
    resolution: "",
    resolvedAt: null,
    resolvedBy: "",
    checklistItems: null,
  }));
  const result = resolveTaskImportRows({
    rows: asTaskRows,
    buildings: buildings.map((row) => ({ id: row.id as string, name: row.name as string })),
    floorsByBuilding,
    areasByBuilding,
    users,
    categories: categories.map((row) => ({ id: row.id as string, name: row.name as string })),
    fallbackOpenedByUserId,
  });
  if (!result.ok) {
    // resolveTaskImportRows soft-fails everything it can; this is unexpected.
    return {
      resolved: [],
      failures: rows.map((row) => ({
        rowNumber: row.rowNumber,
        externalId: row.externalId || null,
        error: dict.superAdmin.scheduledCallsUploadFailed,
      })),
      categoryNamesToCreate: [],
    };
  }

  const byRowNumber = new Map(result.rows.map((row) => [row.rowNumber, row]));
  const resolved: ResolvedRow[] = [];
  const failures: RowFailure[] = [];
  for (const row of rows) {
    const match = byRowNumber.get(row.rowNumber);
    const externalId = row.externalId.trim() || null;
    if (!match?.buildingId) {
      failures.push({
        rowNumber: row.rowNumber,
        externalId,
        error: t(dict.superAdmin.scheduledCallsUnknownLocation, { location: row.location || "—" }),
      });
      continue;
    }
    const schedule = scheduledCallScheduleFromImport(row.frequency, row.nextRun, row.createdAt);
    if (!schedule) {
      failures.push({
        rowNumber: row.rowNumber,
        externalId,
        error: t(dict.superAdmin.scheduledCallsUnknownSchedule, { value: row.frequency }),
      });
      continue;
    }
    resolved.push({
      rowNumber: row.rowNumber,
      externalId,
      description: row.description,
      buildingId: match.buildingId,
      floorId: match.floorId,
      areaId: match.areaId,
      categoryName: match.categoryName,
      openedByUserId: match.openedByUserId,
      openedByName: row.createdBy.trim() || null,
      assigneeIds: match.assigneeIds,
      unknownAssignees: row.assignees.filter((name) => !userNames.has(normalizeLookup(name))),
      schedule: schedule.schedule,
      createdAt: row.createdAt,
      anchorAt: schedule.anchorAt,
    });
  }
  return { resolved, failures, categoryNamesToCreate: result.categoryNamesToCreate };
}

/** This complex's scheduled calls by external id, and ids taken by anything else. */
async function existingByExternalId(complexId: string, externalIds: string[]) {
  if (externalIds.length === 0) return { mine: new Map<string, string>(), taken: new Set<string>() };
  const rows = await sql`
    SELECT t.id, t.external_id, t.type, b.complex_id
    FROM tasks t
    LEFT JOIN buildings b ON b.id = t.building_id
    WHERE t.external_id = ANY(${externalIds}::text[])
  `;
  const mine = new Map<string, string>();
  const taken = new Set<string>();
  for (const row of rows) {
    const externalId = row.external_id as string;
    if (row.type === "template-call" && row.complex_id === complexId) mine.set(externalId, row.id as string);
    else taken.add(externalId);
  }
  return { mine, taken };
}

export type ScheduledCallPreviewRow = {
  rowNumber: number;
  existing: boolean;
  error?: string;
  warnings: string[];
  schedule?: CallScheduleColumns;
};

export async function previewScheduledCallImportAction(
  complexId: string,
  rows: ScheduledCallImportRow[],
): Promise<{ error?: string; rows?: ScheduledCallPreviewRow[] }> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  const scopedComplexId = await resolveComplexId(complexId);
  if (!scopedComplexId) return { error: dict.admin.complexNotFound };

  const { resolved, failures } = await resolveRows(scopedComplexId, rows, user.id, dict);
  const externalIds = rows.map((row) => row.externalId.trim()).filter(Boolean);
  const { mine, taken } = await existingByExternalId(scopedComplexId, externalIds);

  const preview: ScheduledCallPreviewRow[] = [];
  for (const failure of failures) {
    preview.push({ rowNumber: failure.rowNumber, existing: false, error: failure.error, warnings: [] });
  }
  for (const row of resolved) {
    if (row.externalId && taken.has(row.externalId)) {
      preview.push({
        rowNumber: row.rowNumber,
        existing: false,
        error: t(dict.superAdmin.scheduledCallsExternalIdTaken, { externalId: row.externalId }),
        warnings: [],
      });
      continue;
    }
    preview.push({
      rowNumber: row.rowNumber,
      existing: row.externalId ? mine.has(row.externalId) : false,
      warnings: row.unknownAssignees.map((name) => t(dict.superAdmin.scheduledCallsUnknownUser, { name })),
      schedule: row.schedule,
    });
  }
  preview.sort((a, b) => a.rowNumber - b.rowNumber);
  return { rows: preview };
}

export async function importScheduledCallsAction(
  complexId: string,
  rows: ScheduledCallImportRow[],
): Promise<{
  error?: string;
  created?: number;
  updated?: number;
  failures?: RowFailure[];
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  if (!Array.isArray(rows) || rows.length === 0) return { error: dict.superAdmin.scheduledCallsUploadEmpty };
  const scopedComplexId = await resolveComplexId(complexId);
  if (!scopedComplexId) return { error: dict.admin.complexNotFound };

  const { resolved, failures, categoryNamesToCreate } = await resolveRows(
    scopedComplexId,
    rows,
    user.id,
    dict,
  );

  const categories = await sql`SELECT id, name FROM task_categories WHERE complex_id = ${scopedComplexId}`;
  const categoryIdByName = new Map(
    categories.map((row) => [normalizeLookup(row.name as string), row.id as string]),
  );
  for (const name of categoryNamesToCreate) {
    if (categoryIdByName.has(normalizeLookup(name))) continue;
    const id = crypto.randomUUID();
    await sql`
      INSERT INTO task_categories (id, name, complex_id)
      VALUES (${id}, ${name}, ${scopedComplexId})
      ON CONFLICT DO NOTHING
    `;
    const [row] = await sql`
      SELECT id FROM task_categories WHERE name = ${name} AND complex_id = ${scopedComplexId} LIMIT 1
    `;
    if (row?.id) categoryIdByName.set(normalizeLookup(name), row.id as string);
  }

  const externalIds = [...new Set(resolved.map((row) => row.externalId).filter((id): id is string => !!id))];
  const { mine, taken } = await existingByExternalId(scopedComplexId, externalIds);

  let created = 0;
  let updated = 0;
  // One transaction per row: a bad row is reported and the rest still import.
  for (const row of resolved) {
    if (row.externalId && taken.has(row.externalId)) {
      failures.push({
        rowNumber: row.rowNumber,
        externalId: row.externalId,
        error: t(dict.superAdmin.scheduledCallsExternalIdTaken, { externalId: row.externalId }),
      });
      continue;
    }
    const existingId = row.externalId ? (mine.get(row.externalId) ?? null) : null;
    const taskId = existingId ?? crypto.randomUUID();
    const categoryId = row.categoryName
      ? (categoryIdByName.get(normalizeLookup(row.categoryName)) ?? null)
      : null;
    const s = row.schedule;

    const queries = existingId
      ? [
          sql`
            UPDATE tasks SET
              opened_by_user_id = ${row.openedByUserId},
              opened_by_name = ${row.openedByName},
              building_id = ${row.buildingId},
              floor_id = ${row.floorId},
              area_id = ${row.areaId},
              task_category_id = ${categoryId},
              description = ${row.description},
              -- missions_cron phases "every N" cadences from created_at.
              created_at = COALESCE(${row.anchorAt}::timestamptz, created_at),
              -- Wanted again if it was deleted in the app.
              is_hidden = false,
              updated_at = now()
            WHERE id = ${taskId} AND type = 'template-call'
          `,
          sql`
            UPDATE mission_schedules SET
              frequency = ${s.frequency},
              weekdays = ${s.weekdays}::smallint[],
              weekday = NULL,
              interval_count = ${s.intervalCount},
              interval_unit = ${s.intervalUnit},
              start_day_of_month = ${s.startDayOfMonth}::smallint,
              start_month = ${s.startMonth}::smallint,
              end_time = NULL,
              end_weekday = NULL,
              end_day_of_month = NULL,
              never_closes = true,
              updated_at = now()
            WHERE template_mission_id = ${taskId}
          `,
          sql`DELETE FROM task_assignees WHERE task_id = ${taskId}`,
        ]
      : [
          sql`
            INSERT INTO tasks (
              id, external_id, opened_by_user_id, opened_by_name, building_id, floor_id,
              area_id, task_category_id, type, description, created_at, updated_at
            )
            VALUES (
              ${taskId}, ${row.externalId}, ${row.openedByUserId}, ${row.openedByName},
              ${row.buildingId}, ${row.floorId}, ${row.areaId}, ${categoryId}, 'template-call',
              ${row.description},
              COALESCE(${row.anchorAt}::timestamptz, ${row.createdAt}::timestamptz, now()),
              COALESCE(${row.createdAt}::timestamptz, now())
            )
          `,
          sql`
            INSERT INTO mission_schedules (
              template_mission_id, frequency, weekdays, weekday, interval_count, interval_unit,
              start_time, end_time, end_weekday, start_day_of_month, end_day_of_month,
              start_month, never_closes, skip_holidays
            )
            VALUES (
              ${taskId}, ${s.frequency}, ${s.weekdays}::smallint[], NULL, ${s.intervalCount},
              ${s.intervalUnit}, NULL, NULL, NULL, ${s.startDayOfMonth}::smallint, NULL,
              ${s.startMonth}::smallint, true, false
            )
          `,
        ];
    if (row.assigneeIds.length > 0) {
      queries.push(sql`
        INSERT INTO task_assignees (task_id, user_id)
        SELECT ${taskId}, unnest(${row.assigneeIds}::uuid[])
        ON CONFLICT DO NOTHING
      `);
    }

    try {
      await sql.transaction(queries);
      if (existingId) updated += 1;
      else {
        created += 1;
        if (row.externalId) mine.set(row.externalId, taskId);
      }
    } catch (error) {
      console.error("importScheduledCallsAction row failed", { rowNumber: row.rowNumber, error });
      failures.push({
        rowNumber: row.rowNumber,
        externalId: row.externalId,
        error: error instanceof Error && error.message
          ? `${dict.superAdmin.scheduledCallsUploadFailed} (${error.message})`
          : dict.superAdmin.scheduledCallsUploadFailed,
      });
    }
  }

  failures.sort((a, b) => a.rowNumber - b.rowNumber);
  return { created, updated, failures };
}
