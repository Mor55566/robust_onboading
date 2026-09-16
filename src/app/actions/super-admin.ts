"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { hashPassword, requireUser } from "@/lib/auth";
import { resolveBuildingId, resolveComplexId } from "@/lib/building";
import { sql } from "@/lib/db";
import { usersSql } from "@/lib/users-db";
import { getDictionary } from "@/i18n/get-dictionary";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  CloudinaryConfigError,
  CloudinaryUploadError,
  deleteCloudinaryByUrls,
  uploadTaskAttachmentsFromUrls,
  type UploadedFile,
} from "@/lib/cloudinary";
import {
  normalizeLookup,
  resolveTaskImportRows,
  type ResolvedTaskImportRow,
  type TaskImportBuilding,
  type TaskImportRow,
} from "@/lib/task-import";
import {
  planAreasImport,
  type AreaImportFloor,
  type EquipmentLocationArea,
} from "@/lib/area-import";
import {
  planCategoriesImport,
  type CategoryImportPlanItem,
  type CategoryImportRow,
} from "@/lib/category-import";
import {
  resolveMissionImportRows,
  type MissionImportRow,
} from "@/lib/mission-import";
import {
  classifyMissionHistoryImportRows,
  type MissionHistoryImportRow,
  type MissionHistoryTemplateMatch,
  type ResolvedMissionHistoryImportRow,
} from "@/lib/mission-history-import";
import {
  cloudinaryPublicIdFromSource,
  isCloudinaryStorageUrl,
  planFileTagsImport,
  resolveFileAttachmentImportRows,
  resolveFileImportRows,
  type FileAttachmentImportDocument,
  type FileImportRow,
  type FileTagImportRow,
} from "@/lib/file-import";
import { listResidentsForImport, residentSql } from "@/lib/resident-db";
import type { ResidentImportRow } from "@/lib/resident-import";
import type { UserImportRow } from "@/lib/user-import";
import type { FloorImportRow } from "@/lib/data-import";
import { importAreasAction } from "@/app/actions/admin-shared";
import type { AreaImportRow } from "@/lib/area-import";
import {
  resolveAutomationImportRows,
  type AutomationImportRow,
} from "@/lib/automation-import";

const ATTACHMENT_SOURCE_SYSTEM = "visitt";
const MISSION_HISTORY_ATTACHMENT_SOURCE_SYSTEM = "visitt-mission-history";

type ImportBuilding = { id: string; name: string };

function normalizeBuildingMatch(value: string) {
  return value
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase();
}

function buildingsForAreaRow(
  row: AreaImportRow,
  inferredName: string | null,
  byName: Map<string, ImportBuilding[]>,
  buildings: ImportBuilding[],
) {
  const explicitName = row.building?.trim() || inferredName;
  if (explicitName) {
    return byName.get(normalizeBuildingMatch(explicitName)) ?? [];
  }

  const location = normalizeBuildingMatch(row.location);
  const locationMatches = buildings.filter((building) => {
    const name = normalizeBuildingMatch(building.name);
    return location === name || location.startsWith(`${name} /`);
  });
  if (locationMatches.length < 2) return locationMatches;

  const longestNameLength = Math.max(
    ...locationMatches.map((building) => normalizeBuildingMatch(building.name).length),
  );
  return locationMatches.filter(
    (building) => normalizeBuildingMatch(building.name).length === longestNameLength,
  );
}

export type DeletableTicket = {
  id: string;
  name: string;
};

export async function importAutomationsAction(
  complexId: string,
  rows: AutomationImportRow[],
): Promise<{ error?: string; created?: number; updated?: number }> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  const parsedComplexId = z.string().uuid().safeParse(complexId);
  if (!parsedComplexId.success || !Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.automationsUploadInvalid };
  }

  const [complex, buildings, categories, users] = await Promise.all([
    sql`SELECT id FROM complexes WHERE id = ${parsedComplexId.data} LIMIT 1`,
    sql`SELECT id, name FROM buildings WHERE complex_id = ${parsedComplexId.data} ORDER BY name`,
    sql`SELECT id, name, parent_category_id FROM task_categories WHERE complex_id = ${parsedComplexId.data} ORDER BY name`,
    usersSql`
      SELECT DISTINCT u.id, u.full_name
      FROM users u
      JOIN user_complex_permissions ucp ON ucp.user_id = u.id
      WHERE ucp.complex_id = ${parsedComplexId.data}
      ORDER BY u.full_name
    `,
  ]);
  if (!complex.length) return { error: dict.admin.complexNotFound };

  const resolved = resolveAutomationImportRows(rows, {
    buildings: buildings.map((row) => ({ id: row.id as string, name: row.name as string })),
    categories: categories.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      parentId: (row.parent_category_id as string | null) ?? null,
    })),
    users: users.map((row) => ({ id: row.id as string, name: row.full_name as string })),
  });
  if (!resolved.ok) {
    return { error: t(dict.superAdmin.uploadRowError, { row: resolved.rowNumber, message: resolved.message }) };
  }

  let created = 0;
  let updated = 0;
  const queries: ReturnType<typeof sql>[] = [];
  for (const row of resolved.rows) {
    const existing = await sql`
      SELECT id FROM automation_rules
      WHERE complex_id = ${parsedComplexId.data}
        AND name = ${row.name}
        AND archived_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const id = (existing[0]?.id as string | undefined) ?? randomUUID();
    if (existing.length) {
      updated += 1;
      queries.push(sql`
        UPDATE automation_rules SET
          trigger_type = ${row.triggerType}, delay_value = NULL, delay_unit = NULL,
          filter_urgencies = ${row.priorities}, building_ids = ${row.buildingIds},
          category_ids = ${row.categoryIds}, subcategory_ids = ${row.subcategoryIds},
          floor_ids = ARRAY[]::uuid[], area_ids = ARRAY[]::uuid[], equipment_ids = ARRAY[]::uuid[],
          action_type = ${row.actionType}, action_urgency = ${row.actionUrgency}, is_active = true
        WHERE id = ${id}
      `);
      queries.push(sql`DELETE FROM automation_rule_users WHERE automation_rule_id = ${id}`);
    } else {
      created += 1;
      queries.push(sql`
        INSERT INTO automation_rules (
          id, complex_id, name, trigger_type, delay_value, delay_unit,
          filter_urgencies, building_ids, category_ids, subcategory_ids,
          floor_ids, area_ids, equipment_ids, action_type, action_urgency,
          created_by_user_id, is_active
        ) VALUES (
          ${id}, ${parsedComplexId.data}, ${row.name}, ${row.triggerType}, NULL, NULL,
          ${row.priorities}, ${row.buildingIds}, ${row.categoryIds}, ${row.subcategoryIds},
          ARRAY[]::uuid[], ARRAY[]::uuid[], ARRAY[]::uuid[], ${row.actionType},
          ${row.actionUrgency}, ${user.id}, true
        )
      `);
    }
    if (row.userIds.length) {
      queries.push(sql`
        INSERT INTO automation_rule_users (automation_rule_id, user_id)
        SELECT ${id}, unnest(${row.userIds}::uuid[])
      `);
    }
  }

  try {
    await sql.transaction(queries);
  } catch (error) {
    console.error("importAutomationsAction failed:", error);
    return { error: dict.superAdmin.automationsUploadFailed };
  }
  revalidatePath("/all-tasks");
  revalidatePath("/profile");
  return { created, updated };
}

export async function importAreasForSuperAdminAction(rows: AreaImportRow[]): Promise<{
  error?: string;
  created?: number;
  updated?: number;
  skipped?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.areasUploadEmpty };
  }

  const buildingRows = await sql`SELECT id, name FROM buildings ORDER BY name ASC`;
  const buildings = buildingRows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
  const byName = new Map<string, Array<{ id: string; name: string }>>();
  for (const building of buildings) {
    const key = normalizeBuildingMatch(building.name);
    byName.set(key, [...(byName.get(key) ?? []), building]);
  }

  const explicitNames = new Set(
    rows.map((row) => row.building?.trim()).filter((name): name is string => Boolean(name)),
  );
  const inferredName = explicitNames.size === 1 ? [...explicitNames][0]! : null;
  const grouped = new Map<string, AreaImportRow[]>();
  let skipped = 0;

  for (const row of rows) {
    const matches = buildingsForAreaRow(row, inferredName, byName, buildings);
    if (matches.length !== 1) {
      // Already surfaced (and confirmed by the user) as a red row in the
      // preview step — skip it here rather than aborting the whole import.
      skipped += 1;
      continue;
    }
    const buildingId = matches[0]!.id;
    grouped.set(buildingId, [...(grouped.get(buildingId) ?? []), row]);
  }

  let created = 0;
  let updated = 0;
  for (const [buildingId, buildingRows] of grouped) {
    const result = await importAreasAction(buildingId, buildingRows, {
      skipExisting: true,
    });
    if (result.error) return { error: result.error };
    created += result.created ?? 0;
    updated += result.updated ?? 0;
    skipped += result.skipped ?? 0;
  }

  revalidatePath("/super-admin");
  return { created, updated, skipped };
}

export async function previewAreasForSuperAdminAction(
  rows: AreaImportRow[],
): Promise<{
  error?: string;
  rows?: Array<{
    key: string;
    label: string;
    detail: string;
    action: "create" | "update" | "skip" | "error";
  }>;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.areasUploadEmpty };
  }

  const [buildingRows, floors, areas] = await Promise.all([
    sql`SELECT id, name FROM buildings ORDER BY name ASC`,
    sql`SELECT id, name, number, building_id FROM floors`,
    sql`
      SELECT id, name, floor_id, parent_area_id, external_id, area_type, qr_code, building_id
      FROM areas
    `,
  ]);
  const buildings = buildingRows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
  const byName = new Map<string, Array<{ id: string; name: string }>>();
  for (const building of buildings) {
    const key = normalizeBuildingMatch(building.name);
    byName.set(key, [...(byName.get(key) ?? []), building]);
  }

  const explicitNames = new Set(
    rows.map((row) => row.building?.trim()).filter((name): name is string => Boolean(name)),
  );
  const inferredName = explicitNames.size === 1 ? [...explicitNames][0]! : null;
  const grouped = new Map<string, { building: { id: string; name: string }; rows: AreaImportRow[] }>();
  const previewRows: Array<{
    key: string;
    label: string;
    detail: string;
    action: "create" | "update" | "skip" | "error";
  }> = [];

  for (const row of rows) {
    const buildingName = row.building?.trim() || inferredName;
    const matches = buildingsForAreaRow(row, inferredName, byName, buildings);
    if (matches.length !== 1) {
      previewRows.push({
        key: `area-building-error-${row.rowNumber}`,
        label: row.name || `#${row.rowNumber}`,
        detail: t(dict.superAdmin.areaBuildingNotFound, {
          name: buildingName || row.name,
        }),
        action: "error",
      });
      continue;
    }
    const building = matches[0]!;
    const group = grouped.get(building.id) ?? { building, rows: [] };
    group.rows.push(row);
    grouped.set(building.id, group);
  }

  for (const { building, rows: buildingRows } of grouped.values()) {
    const buildingAreas = areas.filter((row) => row.building_id === building.id);
    const existingByExternalId = new Map(
      buildingAreas
        .filter((row) => String(row.external_id ?? "").trim())
        .map((row) => [
          String(row.external_id).trim().toLocaleLowerCase(),
          row,
        ]),
    );
    const skippedRows = buildingRows.filter(
      (row) => {
        const existing = existingByExternalId.get(
          row.externalId.trim().toLocaleLowerCase(),
        );
        return Boolean(existing) && String(existing!.name).trim() === row.name.trim();
      },
    );
    const updatedRows = buildingRows.flatMap((row) => {
      const existing = existingByExternalId.get(
        row.externalId.trim().toLocaleLowerCase(),
      );
      if (!existing || String(existing.name).trim() === row.name.trim()) return [];
      return [{ row, previousName: String(existing.name) }];
    });
    const rowsToCreate = buildingRows.filter(
      (row) =>
        !existingByExternalId.has(row.externalId.trim().toLocaleLowerCase()),
    );
    const plan = planAreasImport({
      rows: rowsToCreate,
      floors: floors
        .filter((row) => row.building_id === building.id)
        .map((row) => ({
          id: row.id as string,
          name: row.name as string,
          number: Number(row.number),
        })),
      areas: buildingAreas
        .map((row) => ({
          id: row.id as string,
          name: row.name as string,
          floor_id: (row.floor_id as string | null) ?? null,
          parent_area_id: (row.parent_area_id as string | null) ?? null,
          external_id: (row.external_id as string | null) ?? null,
          area_type: (row.area_type as string | null) ?? null,
          qr_code: (row.qr_code as string | null) ?? null,
        })),
      buildingName: building.name,
      matchExistingByExternalIdOnly: true,
    });
    const rowsToCreateByNumber = new Map(rowsToCreate.map((row) => [row.rowNumber, row]));

    previewRows.push(
      ...skippedRows.map((row) => ({
        key: `area-skip-${row.rowNumber}-${row.externalId}`,
        label: row.name,
        detail: [building.name, row.location].filter(Boolean).join(" · "),
        action: "skip" as const,
      })),
      ...updatedRows.map(({ row, previousName }) => ({
        key: `area-update-${row.rowNumber}-${row.externalId}`,
        label: row.name,
        detail: t(dict.admin.areasUploadPreviewChangeName, {
          from: previousName,
          to: row.name,
        }),
        action: "update" as const,
      })),
      ...plan.createdParents.map((item) => ({
        key: `area-parent-${item.rowNumber}-${item.areaId}`,
        label: item.name,
        detail: [building.name, item.locationLabel || item.name].filter(Boolean).join(" · "),
        action: "create" as const,
      })),
      ...plan.items.map((item) => ({
        key: `area-${item.rowNumber}-${item.areaId}`,
        label: item.name,
        detail: [building.name, item.locationLabel].filter(Boolean).join(" · "),
        action: item.action === "update" ? ("skip" as const) : ("create" as const),
      })),
      // Rows that failed to resolve (e.g. an unknown floor) — will NOT be
      // uploaded. Always shown to the user, never silently dropped.
      ...plan.issues.map((issue) => ({
        key: `area-error-${issue.rowNumber}-${issue.code}`,
        label: rowsToCreateByNumber.get(issue.rowNumber)?.name || `#${issue.rowNumber}`,
        detail: issue.message,
        action: "error" as const,
      })),
    );
  }

  return { rows: previewRows };
}

export async function importFloorsAction(
  rows: FloorImportRow[],
  buildingId: string,
): Promise<{
  error?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const parsedBuildingId = z.string().uuid().safeParse(buildingId);
  if (!parsedBuildingId.success) {
    return { error: dict.superAdmin.floorsUploadBuildingRequired };
  }

  const parsed = z.array(z.object({
    rowNumber: z.number().int().positive(),
    externalId: z.string().trim().max(500),
    name: z.string().trim().min(1).max(500),
    number: z.number().int(),
  })).min(1).max(10_000).safeParse(rows);
  if (!parsed.success) {
    return { error: dict.superAdmin.floorsUploadInvalidRow };
  }

  const [buildingRows, floorRows] = await Promise.all([
    sql`SELECT id FROM buildings WHERE id = ${parsedBuildingId.data}`,
    sql`SELECT id, building_id, name, number, external_id FROM floors`,
  ]);
  if (buildingRows.length === 0) {
    return { error: dict.superAdmin.floorBuildingNotFound };
  }
  const targetBuildingId = parsedBuildingId.data;
  const normalized = (value: string) => value.trim().toLocaleLowerCase();

  const incomingExternalIds = new Set<string>();
  const claimedFloorIds = new Set<string>();
  const existingByExternalId = new Map<string, typeof floorRows>();
  for (const floor of floorRows) {
    const externalId = String(floor.external_id ?? "").trim();
    if (!externalId) continue;
    const key = normalized(externalId);
    existingByExternalId.set(key, [...(existingByExternalId.get(key) ?? []), floor]);
  }

  const planned: Array<{
    id: string;
    buildingId: string;
    externalId: string | null;
    name: string;
    number: number;
    isNew: boolean;
    rowNumber: number;
  }> = [];

  function rowError(rowNumber: number, message: string) {
    return { error: t(dict.superAdmin.uploadRowError, { row: rowNumber, message }) };
  }

  for (const row of parsed.data) {
    const externalId = row.externalId.trim();
    if (externalId) {
      const externalKey = normalized(externalId);
      if (incomingExternalIds.has(externalKey)) {
        return rowError(row.rowNumber, dict.superAdmin.floorsUploadDuplicateExternalId);
      }
      incomingExternalIds.add(externalKey);
    }

    const byExternal = externalId
      ? existingByExternalId.get(normalized(externalId)) ?? []
      : [];
    if (byExternal.length > 1) {
      return rowError(row.rowNumber, dict.superAdmin.floorsUploadInvalidRow);
    }
    // Level 0 has no per-building uniqueness (any number of floors can share it),
    // so it never resolves to a single "the floor at this level" match.
    const byBuildingAndNumber = row.number === 0 ? [] : floorRows.filter((floor) =>
      floor.building_id === targetBuildingId && Number(floor.number) === row.number,
    );
    if (
      byExternal[0] &&
      byBuildingAndNumber[0] &&
      byExternal[0].id !== byBuildingAndNumber[0].id
    ) {
      return rowError(row.rowNumber, dict.superAdmin.floorsUploadInvalidRow);
    }
    const existing = byExternal[0] ?? (byBuildingAndNumber.length === 1
      ? byBuildingAndNumber[0]
      : undefined);
    if (existing && claimedFloorIds.has(existing.id as string)) {
      return rowError(row.rowNumber, dict.superAdmin.floorsUploadInvalidRow);
    }
    if (existing) claimedFloorIds.add(existing.id as string);

    planned.push({
      id: existing ? existing.id as string : randomUUID(),
      buildingId: targetBuildingId,
      externalId: externalId || (existing?.external_id as string | null) || null,
      name: row.name,
      number: row.number,
      isNew: !existing,
      rowNumber: row.rowNumber,
    });
  }

  const duplicateLevels = new Map<string, number>();
  for (const floor of planned) {
    if (floor.number === 0) continue;
    const key = `${floor.buildingId}:${floor.number}`;
    const firstRowNumber = duplicateLevels.get(key);
    if (firstRowNumber !== undefined) {
      return rowError(
        floor.rowNumber,
        t(dict.superAdmin.floorsUploadDuplicateLevel, { row: firstRowNumber }),
      );
    }
    duplicateLevels.set(key, floor.rowNumber);
  }

  const temporaryBase = -2_000_000;
  const parkQueries = planned.filter((floor) => !floor.isNew).map((floor, index) => sql`
    UPDATE floors SET number = ${temporaryBase - index} WHERE id = ${floor.id}
  `);
  const writeQueries = planned.map((floor) => floor.isNew ? sql`
    INSERT INTO floors (id, building_id, name, number, external_id)
    VALUES (${floor.id}, ${floor.buildingId}, ${floor.name}, ${floor.number}, ${floor.externalId})
  ` : sql`
    UPDATE floors
    SET building_id = ${floor.buildingId}, name = ${floor.name},
        number = ${floor.number}, external_id = ${floor.externalId}
    WHERE id = ${floor.id}
  `);

  try {
    await sql.transaction([...parkQueries, ...writeQueries]);
  } catch (error) {
    console.error("importFloorsAction failed:", error);
    const dbError = error as { message?: string; detail?: string };
    const detail = dbError.detail || dbError.message;
    return {
      error: detail
        ? `${dict.superAdmin.floorsUploadFailed} (${detail})`
        : dict.superAdmin.floorsUploadFailed,
    };
  }

  revalidatePath("/buildings");
  revalidatePath("/super-admin");
  return {
    created: planned.filter((floor) => floor.isNew).length,
    updated: planned.filter((floor) => !floor.isNew).length,
  };
}

export async function getDeletableTicketsAction(): Promise<{
  error?: string;
  tickets?: DeletableTicket[];
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const rows = await sql`
    SELECT id, title, description
    FROM tasks
    WHERE type = 'task'
    ORDER BY created_at DESC, id DESC
  `;

  return {
    tickets: rows.map((row) => ({
      id: row.id as string,
      name:
        ((row.title as string | null) ?? "").trim() ||
        ((row.description as string | null) ?? "").trim() ||
        (row.id as string),
    })),
  };
}

export async function deleteTicketsAction(ticketIds: string[]): Promise<{
  error?: string;
  success?: string;
  deleted?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const parsed = z.array(z.string().uuid()).min(1).max(10_000).safeParse(ticketIds);
  if (!parsed.success) {
    return { error: dict.errors.invalidInput };
  }
  const ids = [...new Set(parsed.data)];

  const tickets = await sql`
    SELECT id
    FROM tasks
    WHERE id = ANY(${ids}::uuid[])
      AND type = 'task'
  `;
  const validIds = tickets.map((row) => row.id as string);
  if (validIds.length === 0) {
    return { error: dict.superAdmin.deleteTicketsNoneSelected };
  }

  const attachmentRows = await sql`
    SELECT storage_url
    FROM task_attachments
    WHERE task_id = ANY(${validIds}::uuid[])
    UNION ALL
    SELECT ca.storage_url
    FROM comment_attachments ca
    JOIN task_comments c ON c.id = ca.comment_id
    WHERE c.task_id = ANY(${validIds}::uuid[])
  `;
  const storageUrls = attachmentRows.map((row) => row.storage_url as string);

  if (storageUrls.length > 0) {
    try {
      await deleteCloudinaryByUrls(storageUrls);
    } catch (error) {
      if (error instanceof CloudinaryConfigError) {
        return { error: dict.errors.cloudinaryNotConfigured };
      }
      console.error("Cloudinary bulk delete failed:", error);
      return { error: dict.errors.attachmentDeleteFailed };
    }
  }

  await sql.transaction([
    sql`
      DELETE FROM task_attachment_sources
      WHERE task_attachment_id IN (
        SELECT id FROM task_attachments
        WHERE task_id = ANY(${validIds}::uuid[])
      )
    `,
    sql`DELETE FROM task_attachments WHERE task_id = ANY(${validIds}::uuid[])`,
    sql`DELETE FROM notifications WHERE ticket_id = ANY(${validIds}::uuid[])`,
    sql`DELETE FROM tasks WHERE id = ANY(${validIds}::uuid[]) AND type = 'task'`,
  ]);

  revalidatePath("/");
  revalidatePath("/my-tasks");
  revalidatePath("/all-tasks");
  revalidatePath("/profile");

  return {
    success: t(dict.superAdmin.deleteTicketsSuccess, { count: validIds.length }),
    deleted: validIds.length,
  };
}

export async function importResidentsAction(
  complexId: string,
  rows: ResidentImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.residentsUploadEmpty };
  }

  const complexRows = await sql`
    SELECT id FROM complexes WHERE id = ${complexId} LIMIT 1
  `;
  if (complexRows.length === 0) {
    return { error: dict.superAdmin.complexNotFound };
  }

  const buildings = await sql`
    SELECT id, name
    FROM buildings
    WHERE complex_id = ${complexId}
    ORDER BY sort_order ASC, name ASC
  `;
  const byName = new Map<string, string[]>();
  for (const building of buildings) {
    const key = (building.name as string).trim().toLocaleLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), building.id as string]);
  }

  const incomingExternalIds = new Set<string>();
  for (const row of rows) {
    if (
      !row ||
      typeof row.externalId !== "string" ||
      typeof row.name !== "string" ||
      typeof row.building !== "string" ||
      !row.externalId.trim() ||
      !row.name.trim()
    ) {
      return { error: dict.superAdmin.residentsUploadInvalidRow };
    }
    const normalizedExternalId = row.externalId.trim().toLocaleLowerCase();
    if (incomingExternalIds.has(normalizedExternalId)) {
      return { error: dict.superAdmin.residentsUploadInvalidRow };
    }
    incomingExternalIds.add(normalizedExternalId);
    if (row.building.trim()) {
      const matches = byName.get(row.building.trim().toLocaleLowerCase()) ?? [];
      if (matches.length !== 1) {
        return {
          error: t(dict.superAdmin.buildingNotFound, { name: row.building }),
        };
      }
    }
  }

  let created = 0;
  let updated = 0;
  const queries = [];
  for (const row of rows) {
    const buildingId = row.building.trim()
      ? byName.get(row.building.trim().toLocaleLowerCase())![0]!
      : null;
    const externalId = row.externalId.trim();
    const displayName = row.name.trim();
    const billingAddress = row.billingAddress?.trim() || null;
    const contacts = Array.isArray(row.contacts) ? row.contacts : [];
    queries.push(residentSql`
      WITH resident_upsert AS (
        INSERT INTO residents (complex_id, external_id, name, billing_address)
        VALUES (${complexId}, ${externalId}, ${displayName}, ${billingAddress})
        ON CONFLICT (complex_id, external_id)
        WHERE external_id IS NOT NULL AND deleted_at IS NULL
        DO UPDATE SET name = EXCLUDED.name, billing_address = EXCLUDED.billing_address
        RETURNING id, (xmax = 0) AS inserted
      ), target_building AS (
        SELECT ${buildingId}::uuid AS id
      ), location_upsert AS (
        INSERT INTO resident_locations (resident_id, purpose, location_type, location_id)
        SELECT resident_upsert.id, 'occupancy', 'building', target_building.id
        FROM resident_upsert, target_building
        WHERE target_building.id IS NOT NULL
        ON CONFLICT (resident_id, purpose, location_type, location_id)
        DO UPDATE SET updated_at = now()
      ), contacts_data AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(contacts)}::jsonb)
          AS c(name text, role text)
      ), contacts_update AS (
        UPDATE resident_users ru
        SET role = contacts_data.role
        FROM contacts_data, resident_upsert
        WHERE ru.resident_id = resident_upsert.id
          AND lower(ru.name) = lower(contacts_data.name)
          AND ru.deleted_at IS NULL
        RETURNING lower(ru.name) AS matched_name
      ), contacts_insert AS (
        INSERT INTO resident_users (resident_id, name, role)
        SELECT resident_upsert.id, contacts_data.name, contacts_data.role
        FROM contacts_data, resident_upsert
        WHERE NOT EXISTS (
          SELECT 1 FROM contacts_update
          WHERE contacts_update.matched_name = lower(contacts_data.name)
        )
      )
      SELECT id, inserted FROM resident_upsert
    `);
  }

  try {
    const chunkSize = 25;
    for (let index = 0; index < queries.length; index += chunkSize) {
      const results = await residentSql.transaction(
        queries.slice(index, index + chunkSize),
      );
      for (const rowResult of results as { inserted: boolean }[][]) {
        if (rowResult[0]?.inserted) created += 1;
        else updated += 1;
      }
    }
  } catch (error) {
    console.error("importResidentsAction failed:", error);
    return { error: dict.superAdmin.residentsUploadFailed };
  }

  revalidatePath("/profile");
  revalidatePath("/residents");
  return {
    success: t(dict.superAdmin.residentsUploadSuccess, {
      create: created,
      update: updated,
    }),
    created,
    updated,
  };
}

export async function importUsersAction(
  complexId: string,
  password: string,
  rows: UserImportRow[],
): Promise<{ error?: string; success?: string; created?: number; updated?: number }> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };
  const parsedComplexId = z.string().uuid().safeParse(complexId);
  if (!parsedComplexId.success || !Array.isArray(rows)) {
    return { error: dict.errors.invalidInput };
  }
  if (rows.length === 0) {
    return { error: dict.superAdmin.usersUploadEmpty };
  }
  const parsedPassword = z.string().min(8).safeParse(password);
  if (!parsedPassword.success) {
    return { error: dict.errors.passwordMin };
  }
  const complexRows = await sql`SELECT id FROM complexes WHERE id = ${parsedComplexId.data} LIMIT 1`;
  if (complexRows.length === 0) return { error: dict.superAdmin.complexNotFound };

  const rowSchema = z.object({
    rowNumber: z.number().int().positive(),
    externalId: z.string().trim().min(1).max(1_000),
    fullName: z.string().trim().min(2),
    email: z.email(),
    phoneNumber: z.number().int().safe().nullable(),
    sourceRole: z.string().trim().min(1),
    roleDescription: z.number().int().safe().nullable(),
  });
  const parsedRows = z.array(rowSchema).max(10_000).safeParse(rows);
  if (!parsedRows.success) return { error: dict.superAdmin.usersUploadInvalidRow };

  const externalIds = parsedRows.data.map((row) => row.externalId);
  const emails = parsedRows.data.map((row) => row.email.toLocaleLowerCase());
  if (new Set(externalIds).size !== externalIds.length || new Set(emails).size !== emails.length) {
    return { error: dict.superAdmin.usersUploadInvalidRow };
  }
  const existing = await usersSql`
    SELECT id, external_id, lower(email) AS email
    FROM users
    WHERE external_id = ANY(${externalIds}::text[])
       OR lower(email) = ANY(${emails}::text[])
  `;
  const byExternalId = new Map(existing.map((row) => [String(row.external_id), String(row.id)]));
  const byEmail = new Map(existing.map((row) => [String(row.email), String(row.id)]));

  let created = 0;
  let updated = 0;
  const queries: ReturnType<typeof usersSql>[] = [];
  const passwordHash = await hashPassword(parsedPassword.data);
  for (const row of parsedRows.data) {
    const email = row.email.toLocaleLowerCase();
    const externalMatch = byExternalId.get(row.externalId);
    const emailMatch = byEmail.get(email);
    if (externalMatch && emailMatch && externalMatch !== emailMatch) {
      return { error: dict.superAdmin.usersUploadConflict };
    }
    const userId = externalMatch ?? emailMatch ?? randomUUID();
    const permissionRole = row.sourceRole === "מנהל נכס" ? "admin" : "user";
    if (externalMatch || emailMatch) {
      queries.push(usersSql`
        UPDATE users
        SET external_id = ${row.externalId}, full_name = ${row.fullName}, email = ${email},
            phone_number = ${row.phoneNumber}, role_description = ${row.roleDescription},
            password_hash = ${passwordHash}
        WHERE id = ${userId}
      `);
      updated += 1;
    } else {
      queries.push(usersSql`
        INSERT INTO users (
          id, external_id, email, full_name, role, phone_number, role_description,
          password_hash
        ) VALUES (
          ${userId}, ${row.externalId}, ${email}, ${row.fullName}, 'user',
          ${row.phoneNumber}, ${row.roleDescription}, ${passwordHash}
        )
      `);
      created += 1;
    }
    queries.push(usersSql`
      DELETE FROM user_complex_permissions
      WHERE user_id = ${userId} AND complex_id = ${parsedComplexId.data}
    `);
    queries.push(usersSql`
      INSERT INTO user_complex_permissions (user_id, complex_id, role)
      VALUES (${userId}, ${parsedComplexId.data}, ${permissionRole})
    `);
  }

  try {
    await usersSql.transaction(queries);
  } catch (error) {
    console.error("importUsersAction failed:", error);
    return { error: dict.superAdmin.usersUploadFailed };
  }
  revalidatePath("/profile");
  revalidatePath("/admin");
  return {
    success: t(dict.superAdmin.usersUploadSuccess, { create: created, update: updated }),
    created,
    updated,
  };
}

export type CreateUserState = {
  error?: string;
  user?: { id: string; fullName: string; email: string };
};

const createUserSchema = z.object({
  complexId: z.string().trim().uuid(),
  fullName: z.string().trim().min(2),
  email: z.email(),
  phoneNumber: z.string().trim(),
  role: z.enum(["user", "admin"]),
  password: z.string().min(8),
});

export async function createUserAction(
  _prev: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { error: dict.errors.unauthorized };

  const parsed = createUserSchema.safeParse({
    complexId: formData.get("complex_id"),
    fullName: formData.get("full_name"),
    email: formData.get("email"),
    phoneNumber: formData.get("phone_number"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.complexId) return { error: dict.admin.complexNotFound };
    if (fieldErrors.email) return { error: dict.errors.invalidEmail };
    if (fieldErrors.password) return { error: dict.errors.passwordMin };
    return { error: dict.errors.nameRequired };
  }

  let phoneNumber: number | null = null;
  const rawPhone = parsed.data.phoneNumber.replace(/[\s()-]/g, "");
  if (rawPhone) {
    if (!/^\d+$/.test(rawPhone) || !Number.isSafeInteger(Number(rawPhone))) {
      return { error: dict.errors.invalidInput };
    }
    phoneNumber = Number(rawPhone);
  }

  const complexRows = await sql`SELECT id FROM complexes WHERE id = ${parsed.data.complexId} LIMIT 1`;
  if (complexRows.length === 0) return { error: dict.admin.complexNotFound };

  const email = parsed.data.email.toLocaleLowerCase();
  const existing = await usersSql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
  if (existing.length > 0) return { error: dict.superAdmin.usersEmailTaken };

  const userId = randomUUID();
  const passwordHash = await hashPassword(parsed.data.password);
  try {
    await usersSql.transaction([
      usersSql`
        INSERT INTO users (id, email, full_name, role, phone_number, password_hash)
        VALUES (${userId}, ${email}, ${parsed.data.fullName}, 'user', ${phoneNumber}, ${passwordHash})
      `,
      usersSql`
        INSERT INTO user_complex_permissions (user_id, complex_id, role)
        VALUES (${userId}, ${parsed.data.complexId}, ${parsed.data.role})
      `,
    ]);
  } catch (error) {
    console.error("createUserAction failed:", error);
    return { error: dict.superAdmin.usersUploadFailed };
  }

  revalidatePath("/profile");
  revalidatePath("/admin");
  return { user: { id: userId, fullName: parsed.data.fullName, email } };
}

function isForeignCloudinaryUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)cloudinary\.com$/i.test(parsed.hostname)) return false;
    const path = parsed.pathname.toLowerCase();
    if (path.includes("/gantzi/")) return true;
    const ourCloud =
      process.env.CLOUDINARY_CLOUD_NAME?.trim().toLowerCase() ||
      process.env.CLOUDINARY_URL?.match(/@([^/?]+)/i)?.[1]?.toLowerCase() ||
      "";
    if (ourCloud) return !path.includes(`/${ourCloud}/`);
    return false;
  } catch {
    return false;
  }
}

type UploadedWithSource = UploadedFile & { source_storage_url: string };

type SourceAttachmentMeta = {
  file_name: string;
  mime_type: string;
  storage_url: string;
};

async function uploadUrlsWithSources(
  urls: string[],
): Promise<UploadedWithSource[]> {
  if (urls.length === 0) return [];
  const uploaded = await uploadTaskAttachmentsFromUrls(urls, { concurrency: 8 });
  return uploaded.map((file, index) => ({
    ...file,
    source_storage_url: urls[index]!,
  }));
}

async function uploadImportUrlsBySource(
  urls: string[],
  dict: Dictionary,
): Promise<
  | { ok: true; bySource: Map<string, UploadedWithSource> }
  | { ok: false; error: string }
> {
  const unique = [...new Set(urls)];
  if (unique.length === 0) {
    return { ok: true, bySource: new Map() };
  }

  try {
    const uploaded = await uploadUrlsWithSources(unique);
    const bySource = new Map<string, UploadedWithSource>();
    for (const file of uploaded) {
      bySource.set(file.source_storage_url, file);
    }
    return { ok: true, bySource };
  } catch (error) {
    if (error instanceof CloudinaryConfigError) {
      return { ok: false, error: dict.errors.cloudinaryNotConfigured };
    }
    const detail =
      error instanceof CloudinaryUploadError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Cloudinary upload failed";
    const match = detail.match(/https?:\/\/\S+/i);
    return {
      ok: false,
      error: t(dict.superAdmin.imageImportFailed, {
        url: match?.[0] ?? unique[0] ?? "",
      }),
    };
  }
}

async function resolveUrlList(
  urls: string[],
  sourceAttachmentByUrl: Map<string, SourceAttachmentMeta>,
): Promise<UploadedWithSource[]> {
  const result: UploadedWithSource[] = [];
  const toUpload: string[] = [];

  for (const url of urls) {
    if (result.some((file) => file.source_storage_url === url)) continue;
    const existing = sourceAttachmentByUrl.get(url);
    if (existing) {
      result.push({ ...existing, source_storage_url: url });
    } else {
      toUpload.push(url);
    }
  }

  if (toUpload.length > 0) {
    const uploaded = await uploadUrlsWithSources(toUpload);
    for (const file of uploaded) {
      result.push(file);
      sourceAttachmentByUrl.set(file.source_storage_url, {
        file_name: file.file_name,
        mime_type: file.mime_type,
        storage_url: file.storage_url,
      });
    }
  }

  return result;
}

async function importRowAttachments(
  row: Pick<ResolvedTaskImportRow, "imageUrls" | "resolutionImageUrls">,
  sourceAttachmentByUrl: Map<string, SourceAttachmentMeta>,
): Promise<
  | { ok: true; opening: UploadedWithSource[]; resolution: UploadedWithSource[] }
  | { ok: false; url: string; detail: string }
> {
  try {
    const opening = await resolveUrlList(row.imageUrls, sourceAttachmentByUrl);
    const openingSources = new Set(opening.map((file) => file.source_storage_url));
    const resolution = await resolveUrlList(
      row.resolutionImageUrls.filter((url) => !openingSources.has(url)),
      sourceAttachmentByUrl,
    );
    return { ok: true, opening, resolution };
  } catch (error) {
    if (error instanceof CloudinaryConfigError) throw error;
    const detail =
      error instanceof CloudinaryUploadError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Cloudinary upload failed";
    const match = detail.match(/https?:\/\/\S+/i);
    return { ok: false, url: match?.[0] ?? "", detail };
  }
}

function queueAttachmentInserts(
  queries: ReturnType<typeof sql>[],
  taskId: string,
  attachmentType: "opening" | "resolution",
  files: UploadedWithSource[],
) {
  if (files.length === 0) return;

  const ids = files.map(() => crypto.randomUUID());
  const fileNames = files.map((file) => file.file_name);
  const mimeTypes = files.map((file) => file.mime_type);
  const storageUrls = files.map((file) => file.storage_url);
  const sourceUrls = files.map((file) => file.source_storage_url);

  // Always attach files to this task; skip only when this task already has the source URL.
  queries.push(sql`
    WITH candidates AS (
      SELECT *
      FROM unnest(
        ${ids}::uuid[],
        ${fileNames}::text[],
        ${mimeTypes}::text[],
        ${storageUrls}::text[],
        ${sourceUrls}::text[]
      ) AS x(id, file_name, mime_type, storage_url, source_storage_url)
    ),
    new_for_task AS (
      SELECT c.*
      FROM candidates c
      WHERE NOT EXISTS (
        SELECT 1
        FROM task_attachment_sources tas
        INNER JOIN task_attachments ta ON ta.id = tas.task_attachment_id
        WHERE tas.source_system = ${ATTACHMENT_SOURCE_SYSTEM}
          AND tas.source_storage_url = c.source_storage_url
          AND ta.task_id = ${taskId}
      )
    ),
    inserted_attachments AS (
      INSERT INTO task_attachments (
        id,
        task_id,
        file_name,
        mime_type,
        storage_url,
        attachment_type
      )
      SELECT
        id,
        ${taskId},
        file_name,
        mime_type,
        storage_url,
        ${attachmentType}
      FROM new_for_task
      RETURNING id
    )
    INSERT INTO task_attachment_sources (
      task_attachment_id,
      source_system,
      source_storage_url,
      imported_at,
      last_checked_at
    )
    SELECT
      nf.id,
      ${ATTACHMENT_SOURCE_SYSTEM},
      nf.source_storage_url,
      now(),
      now()
    FROM new_for_task nf
    INNER JOIN inserted_attachments ia ON ia.id = nf.id
    WHERE NOT EXISTS (
      SELECT 1
      FROM task_attachment_sources tas
      WHERE tas.source_system = ${ATTACHMENT_SOURCE_SYSTEM}
        AND tas.source_storage_url = nf.source_storage_url
    )
    ON CONFLICT (source_system, source_storage_url) DO NOTHING
  `);
}

class RowImportError extends Error {
  constructor(
    public readonly rowNumber: number | null,
    public readonly originalError: unknown,
  ) {
    super(`Row import failed${rowNumber != null ? ` at row ${rowNumber}` : ""}`);
  }
}

// Postgres errors (via @neondatabase/serverless's NeonDbError) carry a
// human-readable `detail` alongside the raw `message` — surface both so a
// failed import row is actionable without digging through server logs.
function describeDbError(error: unknown): string {
  if (error && typeof error === "object") {
    const detail = "detail" in error ? (error as { detail?: unknown }).detail : undefined;
    const message = "message" in error ? (error as { message?: unknown }).message : undefined;
    const parts = [message, detail].filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    );
    if (parts.length > 0) return parts.join(" — ");
  }
  return String(error);
}

export async function importTasksAction(
  rows: TaskImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.uploadEmpty };
  }

  const [buildings, floors, areas, complexUsers, categories] = await Promise.all([
    sql`SELECT id, name, complex_id FROM buildings ORDER BY name ASC`,
    sql`SELECT id, name, number, building_id FROM floors`,
    sql`
      SELECT id, name, floor_id, parent_area_id, building_id
      FROM areas
    `,
    usersSql`
      SELECT u.id, u.full_name, ucp.complex_id
      FROM users u
      INNER JOIN user_complex_permissions ucp ON ucp.user_id = u.id
    `,
    sql`SELECT id, name FROM task_categories`,
  ]);

  const usersByComplex = new Map<string, { id: string; full_name: string }[]>();
  for (const row of complexUsers) {
    const complexId = row.complex_id as string;
    const list = usersByComplex.get(complexId) ?? [];
    list.push({ id: row.id as string, full_name: row.full_name as string });
    usersByComplex.set(complexId, list);
  }
  const users = buildings.flatMap((building) => {
    const complexId = building.complex_id as string | null;
    if (!complexId) return [];
    return (usersByComplex.get(complexId) ?? []).map((u) => ({
      id: u.id,
      full_name: u.full_name,
      building_id: building.id as string,
    }));
  });

  const floorsByBuilding = new Map<string, AreaImportFloor[]>();
  for (const row of floors) {
    const buildingId = row.building_id as string;
    const list = floorsByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      number: Number(row.number),
    });
    floorsByBuilding.set(buildingId, list);
  }

  const areasByBuilding = new Map<string, EquipmentLocationArea[]>();
  for (const row of areas) {
    const buildingId = row.building_id as string;
    const list = areasByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      parent_area_id: (row.parent_area_id as string | null) ?? null,
    });
    areasByBuilding.set(buildingId, list);
  }

  const resolved = resolveTaskImportRows({
    rows,
    buildings: buildings.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    floorsByBuilding,
    areasByBuilding,
    users: users.map((row) => ({
      id: row.id as string,
      full_name: row.full_name as string,
      building_id: (row.building_id as string | null) ?? null,
    })),
    categories: categories.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    fallbackOpenedByUserId: user.id,
  });

  if (!resolved.ok) {
    const message =
      resolved.code === "building"
        ? t(dict.superAdmin.buildingNotFound, { name: resolved.value })
        : resolved.code === "location"
          ? t(dict.superAdmin.locationNotFound, {
              location: resolved.value,
            })
          : t(dict.superAdmin.userNotFound, { name: resolved.value });
    return {
      error: t(dict.superAdmin.uploadRowError, {
        row: resolved.rowNumber,
        message,
      }),
    };
  }

  const categoryIdByName = new Map(
    categories.map((row) => [
      (row.name as string).trim().toLowerCase(),
      row.id as string,
    ]),
  );

  for (const name of resolved.categoryNamesToCreate) {
    const id = crypto.randomUUID();
    try {
      // TODO: this bulk-import fallback doesn't carry per-row complex
      // context yet, so auto-created categories always land on the seed
      // complex from db/task_categories_add_complex_id.sql.
      await sql`
        INSERT INTO task_categories (id, name, complex_id)
        VALUES (${id}, ${name}, 'c4c85637-4085-4761-8a4e-3ef08b0eacb5')
      `;
      categoryIdByName.set(name.trim().toLowerCase(), id);
    } catch {
      // Race / unique constraint — re-read.
      const existing = await sql`
        SELECT id FROM task_categories WHERE name = ${name} LIMIT 1
      `;
      if (existing[0]?.id) {
        categoryIdByName.set(name.trim().toLowerCase(), existing[0].id as string);
      }
    }
  }

  const callNumbers = [
    ...new Set(
      resolved.rows
        .map((row) => row.callNumber?.trim())
        .filter((callNumber): callNumber is string => Boolean(callNumber)),
    ),
  ];

  const existingByCallNumber = new Map<string, string>();
  const sourceAttachmentByUrl = new Map<string, SourceAttachmentMeta>();

  const [existingTasks, existingSourceRows] = await Promise.all([
    callNumbers.length > 0
      ? sql`
          SELECT id, call_number
          FROM tasks
          WHERE type = 'task'
            AND call_number = ANY(${callNumbers}::bigint[])
        `
      : Promise.resolve([] as Record<string, unknown>[]),
    sql`
      SELECT
        tas.source_storage_url,
        ta.file_name,
        ta.mime_type,
        ta.storage_url
      FROM task_attachment_sources tas
      INNER JOIN task_attachments ta ON ta.id = tas.task_attachment_id
      WHERE tas.source_system = ${ATTACHMENT_SOURCE_SYSTEM}
    `,
  ]);

  for (const row of existingTasks) {
    const callNumber = row.call_number == null ? "" : String(row.call_number);
    if (callNumber) existingByCallNumber.set(callNumber, row.id as string);
  }
  for (const row of existingSourceRows) {
    sourceAttachmentByUrl.set(row.source_storage_url as string, {
      file_name: row.file_name as string,
      mime_type: row.mime_type as string,
      storage_url: row.storage_url as string,
    });
  }

  // Upload every missing image for this batch with a bounded worker pool.
  // Once this finishes, each row below only maps already-uploaded assets.
  const allSourceUrls = [
    ...new Set(
      resolved.rows.flatMap((row) => [
        ...row.imageUrls,
        ...row.resolutionImageUrls,
      ]),
    ),
  ];
  const missingSourceUrls = allSourceUrls.filter(
    (url) => !sourceAttachmentByUrl.has(url),
  );

  if (missingSourceUrls.length > 0) {
    try {
      const uploaded = await uploadUrlsWithSources(missingSourceUrls);
      for (const file of uploaded) {
        sourceAttachmentByUrl.set(file.source_storage_url, {
          file_name: file.file_name,
          mime_type: file.mime_type,
          storage_url: file.storage_url,
        });
      }
    } catch (error) {
      if (error instanceof CloudinaryConfigError) {
        return { error: dict.errors.cloudinaryNotConfigured, created: 0, updated: 0 };
      }
      if (error instanceof CloudinaryUploadError) {
        if (/missing permissions|actions=\["create"\]/i.test(error.message)) {
          return { error: dict.errors.cloudinaryPermissionDenied, created: 0, updated: 0 };
        }
        const match = error.message.match(/https?:\/\/\S+/i);
        return {
          error: t(dict.superAdmin.uploadRowError, {
            row: resolved.rows.find((row) =>
              [...row.imageUrls, ...row.resolutionImageUrls].includes(
                match?.[0] ?? "",
              ),
            )?.rowNumber ?? 1,
            message: t(dict.superAdmin.imageImportFailed, {
              url: match?.[0] ?? error.message,
            }),
          }),
          created: 0,
          updated: 0,
        };
      }
      throw error;
    }
  }

  const queries: ReturnType<typeof sql>[] = [];
  const rowBoundaries: { rowNumber: number; start: number; end: number }[] = [];
  let created = 0;
  let updated = 0;
  const CHUNK = 40;

  async function flushQueries() {
    if (queries.length === 0) return;
    const batch = queries.splice(0, queries.length);
    const boundaries = rowBoundaries.splice(0, rowBoundaries.length);
    for (let i = 0; i < batch.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, batch.length);
      try {
        await sql.transaction(batch.slice(i, end));
      } catch (error) {
        // Narrow down which row in this chunk caused the failure by
        // replaying each row's queries on their own — the failed chunk
        // transaction rolled back, so DB state is unchanged and the
        // replay reproduces the same error on the same row.
        const rowsInChunk = boundaries.filter(
          (b) => b.start < end && b.end > i,
        );
        let failingRowNumber = rowsInChunk[0]?.rowNumber ?? null;
        for (const boundary of rowsInChunk) {
          try {
            await sql.transaction(batch.slice(boundary.start, boundary.end));
          } catch {
            failingRowNumber = boundary.rowNumber;
            break;
          }
        }
        throw new RowImportError(failingRowNumber, error);
      }
    }
  }

  try {
    for (const row of resolved.rows) {
      const rowQueryStart = queries.length;
      const existingTaskId = row.callNumber
        ? (existingByCallNumber.get(row.callNumber.trim()) ?? null)
        : null;

      const uploaded = await importRowAttachments(row, sourceAttachmentByUrl);
      if (!uploaded.ok) {
        await flushQueries();
        revalidatePath("/");
        revalidatePath("/all-tasks");
        revalidatePath("/my-tasks");
        return {
          error: t(dict.superAdmin.uploadRowError, {
            row: row.rowNumber,
            message: t(dict.superAdmin.imageImportFailed, {
              url: uploaded.url || uploaded.detail,
            }),
          }),
          created,
          updated,
        };
      }

      const categoryId = row.categoryName
        ? (categoryIdByName.get(row.categoryName.trim().toLowerCase()) ?? null)
        : null;

      const taskId = existingTaskId ?? crypto.randomUUID();

      if (existingTaskId) {
        queries.push(sql`
          UPDATE tasks
          SET
            opened_by_user_id = ${row.openedByUserId},
            opened_by_name = ${row.openedByName},
            building_id = ${row.buildingId},
            task_category_id = ${categoryId},
            floor_id = ${row.floorId},
            area_id = ${row.areaId},
            urgency = ${row.urgency},
            status = ${row.status},
            description = ${row.description},
            call_number = ${row.callNumber}::bigint,
            due_at = ${row.dueAt},
            updated_at = now(),
            resolution = ${row.resolution},
            resolved_at = ${row.resolvedAt}::timestamptz,
            resolved_by_user_id = ${row.resolvedByUserId}
          WHERE id = ${taskId}
            AND type = 'task'
        `);

        queries.push(sql`
          DELETE FROM task_assignees
          WHERE task_id = ${taskId}
        `);

        updated += 1;
      } else {
        queries.push(sql`
          INSERT INTO tasks (
            id,
            opened_by_user_id,
            opened_by_name,
            building_id,
            task_category_id,
            floor_id,
            area_id,
            type,
            urgency,
            status,
            description,
            call_number,
            due_at,
            created_at,
            updated_at,
            resolution,
            resolved_at,
            resolved_by_user_id
          )
          VALUES (
            ${taskId},
            ${row.openedByUserId},
            ${row.openedByName},
            ${row.buildingId},
            ${categoryId},
            ${row.floorId},
            ${row.areaId},
            'task',
            ${row.urgency},
            ${row.status},
            ${row.description},
            ${row.callNumber}::bigint,
            ${row.dueAt},
            COALESCE(${row.createdAt}::timestamptz, now()),
            COALESCE(${row.createdAt}::timestamptz, now()),
            ${row.resolution},
            ${row.resolvedAt}::timestamptz,
            ${row.resolvedByUserId}
          )
        `);

        if (row.callNumber) {
          existingByCallNumber.set(row.callNumber.trim(), taskId);
        }
        created += 1;
      }

      if (row.assigneeIds.length > 0) {
        queries.push(sql`
          INSERT INTO task_assignees (task_id, user_id)
          SELECT ${taskId}, unnest(${row.assigneeIds}::uuid[])
        `);
      }

      queueAttachmentInserts(queries, taskId, "opening", uploaded.opening);
      queueAttachmentInserts(
        queries,
        taskId,
        "resolution",
        uploaded.resolution,
      );

      // A missing checklist column means "leave existing data alone". When
      // present (including an empty value), the CSV is authoritative.
      if (row.checklistItems !== null) {
        queries.push(sql`
          DELETE FROM task_checklists
          WHERE task_id = ${taskId}
        `);

        if (row.checklistItems.length > 0) {
          const checklistId = crypto.randomUUID();
          const itemIds = row.checklistItems.map(() => crypto.randomUUID());
          queries.push(sql`
            INSERT INTO task_checklists (id, task_id, title, sort_order)
            VALUES (${checklistId}, ${taskId}, ${"צ'קליסט"}, 0)
          `);
          queries.push(sql`
            INSERT INTO task_checklist_items (
              id, task_checklist_id, label, sort_order, is_completed,
              completed_at, completed_by_user_id
            )
            SELECT
              x.id,
              ${checklistId},
              x.label,
              x.sort_order,
              x.is_completed,
              CASE WHEN x.is_completed THEN now() ELSE NULL END,
              CASE WHEN x.is_completed THEN ${user.id}::uuid ELSE NULL END
            FROM unnest(
              ${itemIds}::uuid[],
              ${row.checklistItems.map((item) => item.label)}::text[],
              ${row.checklistItems.map((_, index) => index)}::int[],
              ${row.checklistItems.map((item) => item.isCompleted)}::boolean[]
            ) AS x(id, label, sort_order, is_completed)
          `);
        }
      }

      rowBoundaries.push({
        rowNumber: row.rowNumber,
        start: rowQueryStart,
        end: queries.length,
      });

      if (queries.length >= CHUNK) {
        await flushQueries();
      }
    }

    await flushQueries();
  } catch (error) {
    await flushQueries().catch(() => undefined);
    if (error instanceof CloudinaryConfigError) {
      return { error: dict.errors.cloudinaryNotConfigured, created, updated };
    }
    if (error instanceof RowImportError) {
      console.error(
        `importTasksAction failed at row ${error.rowNumber}:`,
        error.originalError,
      );
      return {
        error:
          error.rowNumber != null
            ? t(dict.superAdmin.uploadRowError, {
                row: error.rowNumber,
                message: describeDbError(error.originalError),
              })
            : dict.admin.uploadImportFailed,
        created,
        updated,
      };
    }
    if (error instanceof CloudinaryUploadError) {
      if (/missing permissions|actions=\["create"\]/i.test(error.message)) {
        return {
          error: dict.errors.cloudinaryPermissionDenied,
          created,
          updated,
        };
      }
      return { error: error.message, created, updated };
    }
    console.error("importTasksAction failed:", error);
    return { error: dict.admin.uploadImportFailed, created, updated };
  }

  revalidatePath("/");
  revalidatePath("/all-tasks");
  revalidatePath("/my-tasks");

  const success =
    updated > 0
      ? t(dict.superAdmin.uploadSuccessDetailed, { created, updated })
      : t(dict.superAdmin.uploadSuccess, { count: created });

  return {
    success,
    created,
    updated,
  };
}

class CategoryImportRowError extends Error {
  constructor(
    public readonly rowNumber: number,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "CategoryImportRowError";
  }
}

export async function importCategoriesAction(
  complexId: string,
  rows: CategoryImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  const parsedComplexId = z.string().uuid().safeParse(complexId);
  if (!parsedComplexId.success) {
    return { error: dict.admin.complexNotFound };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.categoriesUploadEmpty };
  }

  try {
    // Schema prerequisites (dropping the old name-uniqueness constraint and
    // scoping external_id uniqueness to complex_id) require table ownership
    // that the app's own DB role (app_user) doesn't have, so they can't run
    // here — see db/task_categories_scope_external_id_unique_per_complex.sql,
    // which must be applied once by a role that owns public.task_categories.

    const existing = await sql`
      SELECT id, name, external_id, parent_category_id
      FROM task_categories
      WHERE complex_id = ${parsedComplexId.data}
    `;

    const plan = planCategoriesImport({
      rows,
      existing: existing.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        external_id: (row.external_id as string | null) ?? null,
        parent_category_id: (row.parent_category_id as string | null) ?? null,
      })),
    });

    if (plan.items.length === 0) {
      return {
        error: t(dict.superAdmin.categoriesUploadAllSkipped, {
          skipped: plan.skipped.length,
        }),
      };
    }

    // Pass 1: upsert name + external_id (parents resolved in pass 2).
    function buildUpsertQuery(item: CategoryImportPlanItem) {
      return item.action === "update"
        ? sql`
            UPDATE task_categories
            SET
              name = ${item.name},
              external_id = ${item.externalId}
            WHERE id = ${item.id} AND complex_id = ${parsedComplexId.data}
          `
        : sql`
            INSERT INTO task_categories (id, name, external_id, complex_id)
            VALUES (${item.id}, ${item.name}, ${item.externalId}, ${parsedComplexId.data})
          `;
    }

    const CHUNK = 40;
    for (let i = 0; i < plan.items.length; i += CHUNK) {
      const chunkItems = plan.items.slice(i, i + CHUNK);
      try {
        await sql.transaction(chunkItems.map(buildUpsertQuery));
      } catch (chunkError) {
        // Isolate which row in the failed chunk caused it.
        for (const item of chunkItems) {
          try {
            await buildUpsertQuery(item);
          } catch (rowError) {
            throw new CategoryImportRowError(item.rowNumber, rowError);
          }
        }
        throw chunkError;
      }
    }

    // Map external_id → uuid after upsert (includes pre-existing + this file).
    // Scoped to this complex: external_id is only unique within a complex.
    const allCategories = await sql`
      SELECT id, external_id
      FROM task_categories
      WHERE complex_id = ${parsedComplexId.data} AND external_id IS NOT NULL
    `;
    const idByExternal = new Map(
      allCategories.map((row) => [
        row.external_id as string,
        row.id as string,
      ]),
    );

    // Pass 2: set parent_category_id from CSV parent category id → our uuid.
    // Every imported row with a parent is guaranteed to resolve (plan filtered).
    function buildParentQuery(item: CategoryImportPlanItem, parentId: string | null) {
      return sql`
        UPDATE task_categories
        SET parent_category_id = ${parentId}
        WHERE id = ${item.id}
      `;
    }

    const parentSteps: { item: CategoryImportPlanItem; parentId: string | null }[] = [];
    for (const item of plan.items) {
      if (!item.parentExternalId) {
        parentSteps.push({ item, parentId: null });
        continue;
      }
      const parentId = idByExternal.get(item.parentExternalId) ?? null;
      if (!parentId || parentId === item.id) {
        // Should not happen after planning; skip rather than orphan.
        continue;
      }
      parentSteps.push({ item, parentId });
    }

    for (let i = 0; i < parentSteps.length; i += CHUNK) {
      const chunkSteps = parentSteps.slice(i, i + CHUNK);
      try {
        await sql.transaction(chunkSteps.map((step) => buildParentQuery(step.item, step.parentId)));
      } catch (chunkError) {
        for (const step of chunkSteps) {
          try {
            await buildParentQuery(step.item, step.parentId);
          } catch (rowError) {
            throw new CategoryImportRowError(step.item.rowNumber, rowError);
          }
        }
        throw chunkError;
      }
    }

    const created = plan.items.filter((item) => item.action === "create").length;
    const updated = plan.items.filter((item) => item.action === "update").length;
    const skipped = plan.skipped.length;

    revalidatePath("/profile");
    revalidatePath("/");

    return {
      success: t(dict.superAdmin.categoriesUploadSuccess, {
        create: created,
        update: updated,
        skipped,
      }),
      created,
      updated,
    };
  } catch (error) {
    console.error("importCategoriesAction failed:", error);
    if (error instanceof CategoryImportRowError) {
      return {
        error: t(dict.superAdmin.categoriesImportRowFailed, {
          row: error.rowNumber,
          message: error.message,
        }),
      };
    }
    const detail =
      error &&
      typeof error === "object" &&
      "detail" in error &&
      typeof (error as { detail?: unknown }).detail === "string"
        ? (error as { detail: string }).detail
        : null;
    const message = detail ?? (error instanceof Error ? error.message : String(error));
    return {
      error: `${dict.superAdmin.categoriesUploadFailed}: ${message}`,
    };
  }
}

export async function importScheduledMissionsAction(
  rows: MissionImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.scheduledMissionsUploadEmpty };
  }

  console.info("importScheduledMissionsAction started", {
    rowCount: rows.length,
  });

  const [buildings, floors, areas, equipment, complexUsers, categories] = await Promise.all([
    sql`SELECT id, name, complex_id FROM buildings ORDER BY name ASC`,
    sql`SELECT id, name, number, building_id FROM floors`,
    sql`
      SELECT id, name, floor_id, parent_area_id, building_id
      FROM areas
    `,
    sql`
      SELECT id, name, building_id, floor_id, area_id
      FROM equipment
    `,
    usersSql`
      SELECT u.id, u.full_name, ucp.complex_id
      FROM users u
      INNER JOIN user_complex_permissions ucp ON ucp.user_id = u.id
    `,
    sql`SELECT id, name FROM task_categories`,
  ]);

  const usersByComplex = new Map<string, { id: string; full_name: string }[]>();
  for (const row of complexUsers) {
    const complexId = row.complex_id as string;
    const list = usersByComplex.get(complexId) ?? [];
    list.push({ id: row.id as string, full_name: row.full_name as string });
    usersByComplex.set(complexId, list);
  }
  const users = buildings.flatMap((building) => {
    const complexId = building.complex_id as string | null;
    if (!complexId) return [];
    return (usersByComplex.get(complexId) ?? []).map((u) => ({
      id: u.id,
      full_name: u.full_name,
      building_id: building.id as string,
    }));
  });

  const floorsByBuilding = new Map<string, AreaImportFloor[]>();
  for (const row of floors) {
    const buildingId = row.building_id as string;
    const list = floorsByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      number: Number(row.number),
    });
    floorsByBuilding.set(buildingId, list);
  }

  const areasByBuilding = new Map<string, EquipmentLocationArea[]>();
  for (const row of areas) {
    const buildingId = row.building_id as string;
    const list = areasByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      parent_area_id: (row.parent_area_id as string | null) ?? null,
    });
    areasByBuilding.set(buildingId, list);
  }

  const equipmentByBuilding = new Map<string, Array<{
    id: string;
    name: string;
    building_id: string;
    floor_id: string | null;
    area_id: string | null;
  }>>();
  for (const row of equipment) {
    const buildingId = row.building_id as string;
    const list = equipmentByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      building_id: buildingId,
      floor_id: (row.floor_id as string | null) ?? null,
      area_id: (row.area_id as string | null) ?? null,
    });
    equipmentByBuilding.set(buildingId, list);
  }

  const resolved = resolveMissionImportRows({
    rows,
    buildings: buildings.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    floorsByBuilding,
    areasByBuilding,
    equipmentByBuilding,
    users: users.map((row) => ({
      id: row.id as string,
      full_name: row.full_name as string,
      building_id: (row.building_id as string | null) ?? null,
    })),
    categories: categories.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    fallbackOpenedByUserId: user.id,
  });

  if (!resolved.ok) {
    return {
      error: t(dict.superAdmin.uploadRowError, {
        row: resolved.rowNumber,
        message: t(dict.superAdmin.userNotFound, { name: resolved.value }),
      }),
    };
  }

  const categoryIdByName = new Map(
    categories.map((row) => [
      (row.name as string).trim().toLowerCase(),
      row.id as string,
    ]),
  );

  for (const name of resolved.categoryNamesToCreate) {
    const id = crypto.randomUUID();
    try {
      // TODO: this bulk-import fallback doesn't carry per-row complex
      // context yet, so auto-created categories always land on the seed
      // complex from db/task_categories_add_complex_id.sql.
      await sql`
        INSERT INTO task_categories (id, name, complex_id)
        VALUES (${id}, ${name}, 'c4c85637-4085-4761-8a4e-3ef08b0eacb5')
      `;
      categoryIdByName.set(name.trim().toLowerCase(), id);
    } catch {
      const existing = await sql`
        SELECT id FROM task_categories WHERE name = ${name} LIMIT 1
      `;
      if (existing[0]?.id) {
        categoryIdByName.set(name.trim().toLowerCase(), existing[0].id as string);
      }
    }
  }

  const externalIds = [
    ...new Set(resolved.rows.map((row) => row.externalId.trim())),
  ];

  const existingRows =
    externalIds.length > 0
      ? await sql`
          SELECT id, external_id
          FROM tasks
          WHERE type = 'template-mission'
            AND external_id = ANY(${externalIds}::text[])
        `
      : [];

  const existingByExternalId = new Map(
    existingRows.map((row) => [row.external_id as string, row.id as string]),
  );

  const queries: ReturnType<typeof sql>[] = [];
  let created = 0;
  let updated = 0;
  const CHUNK = 40;

  async function flushQueries() {
    if (queries.length === 0) return;
    const batch = queries.splice(0, queries.length);
    for (let i = 0; i < batch.length; i += CHUNK) {
      await sql.transaction(batch.slice(i, i + CHUNK));
    }
  }

  try {
    for (const row of resolved.rows) {
      const existingMissionId =
        existingByExternalId.get(row.externalId.trim()) ?? null;
      const missionId = existingMissionId ?? crypto.randomUUID();
      const categoryId = row.categoryName
        ? (categoryIdByName.get(row.categoryName.trim().toLowerCase()) ?? null)
        : null;

      const {
        frequency,
        weekdays,
        weekday,
        intervalCount,
        intervalUnit,
      } = row.schedule;

      if (existingMissionId) {
        queries.push(sql`
          UPDATE tasks
          SET
            opened_by_user_id = ${row.openedByUserId},
            opened_by_name = ${row.openedByName},
            building_id = ${row.buildingId},
            task_category_id = ${categoryId},
            floor_id = ${row.floorId},
            area_id = ${row.areaId},
            title = ${row.title},
            description = ${row.description},
            recurrence_period_start = ${row.startDate}::timestamptz,
            updated_at = COALESCE(${row.createdAt}::timestamptz, now())
          WHERE id = ${missionId}
            AND type = 'template-mission'
        `);

        queries.push(sql`
          UPDATE mission_schedules
          SET
            frequency = ${frequency},
            weekdays = ${weekdays}::smallint[],
            weekday = ${weekday},
            interval_count = ${intervalCount},
            interval_unit = ${intervalUnit},
            skip_holidays = ${row.skipHolidays},
            updated_at = now()
          WHERE template_mission_id = ${missionId}
        `);

        queries.push(sql`
          DELETE FROM task_assignees
          WHERE task_id = ${missionId}
        `);

        updated += 1;
      } else {
        queries.push(sql`
          INSERT INTO tasks (
            id,
            external_id,
            opened_by_user_id,
            opened_by_name,
            building_id,
            task_category_id,
            floor_id,
            area_id,
            type,
            title,
            description,
            recurrence_period_start,
            created_at,
            updated_at
          )
          VALUES (
            ${missionId},
            ${row.externalId},
            ${row.openedByUserId},
            ${row.openedByName},
            ${row.buildingId},
            ${categoryId},
            ${row.floorId},
            ${row.areaId},
            'template-mission',
            ${row.title},
            ${row.description},
            ${row.startDate}::timestamptz,
            COALESCE(${row.createdAt}::timestamptz, now()),
            COALESCE(${row.createdAt}::timestamptz, now())
          )
        `);

        queries.push(sql`
          INSERT INTO mission_schedules (
            template_mission_id,
            frequency,
            weekdays,
            weekday,
            interval_count,
            interval_unit,
            skip_holidays
          )
          VALUES (
            ${missionId},
            ${frequency},
            ${weekdays}::smallint[],
            ${weekday},
            ${intervalCount},
            ${intervalUnit},
            ${row.skipHolidays}
          )
        `);

        existingByExternalId.set(row.externalId.trim(), missionId);
        created += 1;
      }

      if (row.assigneeIds.length > 0) {
        queries.push(sql`
          INSERT INTO task_assignees (task_id, user_id)
          SELECT ${missionId}, unnest(${row.assigneeIds}::uuid[])
        `);
      }

      queries.push(sql`
        DELETE FROM task_checklists
        WHERE task_id = ${missionId}
      `);

      if (row.checklistGroups.length > 0) {
        for (const [checklistIndex, checklist] of row.checklistGroups.entries()) {
          const { title: checklistTitle, items } = checklist;
          const checklistId = crypto.randomUUID();
          const itemIds = items.map(() => crypto.randomUUID());
          queries.push(sql`
            INSERT INTO task_checklists (id, task_id, title, sort_order)
            VALUES (${checklistId}, ${missionId}, ${checklistTitle}, ${checklistIndex})
          `);
          if (checklist.locations.length > 0) {
            queries.push(sql`
              INSERT INTO checklist_locations (
                task_checklist_id, building_id, floor_id, area_id
              )
              SELECT ${checklistId}, x.building_id, x.floor_id, x.area_id
              FROM unnest(
                ${checklist.locations.map((location) => location.buildingId)}::uuid[],
                ${checklist.locations.map((location) => location.floorId)}::uuid[],
                ${checklist.locations.map((location) => location.areaId)}::uuid[]
              ) AS x(building_id, floor_id, area_id)
            `);
          }
          queries.push(sql`
            INSERT INTO task_checklist_items (
              id, task_checklist_id, label, sort_order, item_type,
              field_type_original, is_required, number_unit, number_rule,
              number_min, number_max, options
            )
            SELECT
              x.id, ${checklistId}, x.label, x.sort_order, x.item_type,
              x.field_type_original, false, x.number_unit, x.number_rule,
              x.number_min, x.number_max, x.options::jsonb
            FROM unnest(
              ${itemIds}::uuid[],
              ${items.map((item) => item.label)}::text[],
              ${items.map((item) => item.sortOrder)}::int[],
              ${items.map((item) => item.itemType)}::text[],
              ${items.map((item) => item.fieldTypeOriginal)}::text[],
              ${items.map((item) => item.numberUnit)}::text[],
              ${items.map((item) => item.numberRule)}::text[],
              ${items.map((item) => item.numberMin)}::numeric[],
              ${items.map((item) => item.numberMax)}::numeric[],
              ${items.map((item) => JSON.stringify(item.options))}::text[]
            ) AS x(
              id, label, sort_order, item_type, field_type_original,
              number_unit, number_rule, number_min, number_max, options
            )
          `);
        }
      }

      if (queries.length >= CHUNK) {
        await flushQueries();
      }
    }

    await flushQueries();
  } catch (error) {
    await flushQueries().catch(() => undefined);
    const databaseError = error as {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      message?: unknown;
      severity?: unknown;
      table?: unknown;
    };
    console.error("importScheduledMissionsAction write failed", {
      code: databaseError.code,
      constraint: databaseError.constraint,
      created,
      detail: databaseError.detail,
      message: databaseError.message,
      severity: databaseError.severity,
      table: databaseError.table,
      updated,
    });
    return {
      error: dict.admin.uploadImportFailed,
      created,
      updated,
    };
  }

  revalidatePath("/profile");
  revalidatePath("/missions");

  const success =
    updated > 0
      ? t(dict.superAdmin.scheduledMissionsUploadSuccessDetailed, {
          created,
          updated,
        })
      : t(dict.superAdmin.scheduledMissionsUploadSuccess, { count: created });

  return {
    success,
    created,
    updated,
  };
}

type MissionHistoryReferenceData = {
  buildings: TaskImportBuilding[];
  floorsByBuilding: Map<string, AreaImportFloor[]>;
  areasByBuilding: Map<string, EquipmentLocationArea[]>;
  usersByNormalizedName: Map<string, string>;
  existingMissionsByExternalId: Map<string, string>;
  existingExternalIdsAllTypes: Set<string>;
  templatesByNormalizedTitle: Map<string, MissionHistoryTemplateMatch>;
};

async function loadMissionHistoryReferenceData(): Promise<MissionHistoryReferenceData> {
  const [buildings, floors, areas, users, existingMissions, existingExternalIds, templates] =
    await Promise.all([
      sql`SELECT id, name FROM buildings ORDER BY name ASC`,
      sql`SELECT id, name, number, building_id FROM floors`,
      sql`
        SELECT id, name, floor_id, parent_area_id, building_id
        FROM areas
      `,
      usersSql`SELECT id, full_name FROM users`,
      sql`
        SELECT id, external_id
        FROM tasks
        WHERE type = 'mission' AND external_id IS NOT NULL
      `,
      sql`SELECT external_id FROM tasks WHERE external_id IS NOT NULL`,
      sql`
        SELECT id, title, task_category_id, building_id, floor_id, area_id
        FROM tasks
        WHERE type = 'template-mission'
      `,
    ]);

  const floorsByBuilding = new Map<string, AreaImportFloor[]>();
  for (const row of floors) {
    const buildingId = row.building_id as string;
    const list = floorsByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      number: Number(row.number),
    });
    floorsByBuilding.set(buildingId, list);
  }

  const areasByBuilding = new Map<string, EquipmentLocationArea[]>();
  for (const row of areas) {
    const buildingId = row.building_id as string;
    const list = areasByBuilding.get(buildingId) ?? [];
    list.push({
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      parent_area_id: (row.parent_area_id as string | null) ?? null,
    });
    areasByBuilding.set(buildingId, list);
  }

  const usersByNormalizedName = new Map<string, string>();
  for (const row of users) {
    const key = normalizeLookup(row.full_name as string);
    if (key && !usersByNormalizedName.has(key)) {
      usersByNormalizedName.set(key, row.id as string);
    }
  }

  const templatesByNormalizedTitle = new Map<string, MissionHistoryTemplateMatch>();
  for (const row of templates) {
    templatesByNormalizedTitle.set(normalizeLookup(row.title as string), {
      id: row.id as string,
      taskCategoryId: (row.task_category_id as string | null) ?? null,
      buildingId: (row.building_id as string | null) ?? null,
      floorId: (row.floor_id as string | null) ?? null,
      areaId: (row.area_id as string | null) ?? null,
    });
  }

  return {
    buildings: buildings.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    floorsByBuilding,
    areasByBuilding,
    usersByNormalizedName,
    existingMissionsByExternalId: new Map(
      existingMissions.map((row) => [
        row.external_id as string,
        row.id as string,
      ]),
    ),
    existingExternalIdsAllTypes: new Set(
      existingExternalIds.map((row) => row.external_id as string),
    ),
    templatesByNormalizedTitle,
  };
}

export async function previewMissionHistoryImportAction(
  rows: MissionHistoryImportRow[],
): Promise<{ error: string } | { rows: ResolvedMissionHistoryImportRow[] }> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.missionHistoryUploadEmpty };
  }

  const refData = await loadMissionHistoryReferenceData();
  return { rows: classifyMissionHistoryImportRows({ rows, ...refData }) };
}

export async function importMissionHistoryAction(
  rows: MissionHistoryImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
  skipped?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.missionHistoryUploadEmpty };
  }

  const refData = await loadMissionHistoryReferenceData();
  const classified = classifyMissionHistoryImportRows({ rows, ...refData });

  const allImageUrls = [
    ...new Set(classified.flatMap((row) => row.imageUrls)),
  ];
  const sourceAttachmentByUrl = new Map<string, SourceAttachmentMeta>();
  if (allImageUrls.length > 0) {
    const existingSourceRows = await sql`
      SELECT
        tas.source_storage_url,
        ta.file_name,
        ta.mime_type,
        ta.storage_url
      FROM task_attachment_sources tas
      INNER JOIN task_attachments ta ON ta.id = tas.task_attachment_id
      WHERE tas.source_system = ${MISSION_HISTORY_ATTACHMENT_SOURCE_SYSTEM}
    `;
    for (const row of existingSourceRows) {
      sourceAttachmentByUrl.set(row.source_storage_url as string, {
        file_name: row.file_name as string,
        mime_type: row.mime_type as string,
        storage_url: row.storage_url as string,
      });
    }
    const missingUrls = allImageUrls.filter(
      (url) => !sourceAttachmentByUrl.has(url),
    );
    if (missingUrls.length > 0) {
      try {
        const uploaded = await uploadUrlsWithSources(missingUrls);
        for (const file of uploaded) {
          sourceAttachmentByUrl.set(file.source_storage_url, {
            file_name: file.file_name,
            mime_type: file.mime_type,
            storage_url: file.storage_url,
          });
        }
      } catch (error) {
        if (error instanceof CloudinaryConfigError) {
          return { error: dict.errors.cloudinaryNotConfigured };
        }
        const detail =
          error instanceof CloudinaryUploadError
            ? error.message
            : error instanceof Error
              ? error.message
              : "Cloudinary upload failed";
        const match = detail.match(/https?:\/\/\S+/i);
        return {
          error: t(dict.superAdmin.imageImportFailed, {
            url: match?.[0] ?? detail,
          }),
        };
      }
    }
  }

  function queueMissionHistoryAttachmentInserts(
    queries: ReturnType<typeof sql>[],
    taskId: string,
    urls: string[],
  ) {
    const files = urls
      .map((url) => sourceAttachmentByUrl.get(url))
      .filter((file): file is SourceAttachmentMeta => file != null)
      .map((file, index) => ({ ...file, source_storage_url: urls[index]! }));
    if (files.length === 0) return;

    const ids = files.map(() => crypto.randomUUID());
    queries.push(sql`
      WITH candidates AS (
        SELECT *
        FROM unnest(
          ${ids}::uuid[],
          ${files.map((f) => f.file_name)}::text[],
          ${files.map((f) => f.mime_type)}::text[],
          ${files.map((f) => f.storage_url)}::text[],
          ${files.map((f) => f.source_storage_url)}::text[]
        ) AS x(id, file_name, mime_type, storage_url, source_storage_url)
      ),
      new_for_task AS (
        SELECT c.*
        FROM candidates c
        WHERE NOT EXISTS (
          SELECT 1
          FROM task_attachment_sources tas
          INNER JOIN task_attachments ta ON ta.id = tas.task_attachment_id
          WHERE tas.source_system = ${MISSION_HISTORY_ATTACHMENT_SOURCE_SYSTEM}
            AND tas.source_storage_url = c.source_storage_url
            AND ta.task_id = ${taskId}
        )
      ),
      inserted_attachments AS (
        INSERT INTO task_attachments (
          id, task_id, file_name, mime_type, storage_url, attachment_type
        )
        SELECT id, ${taskId}, file_name, mime_type, storage_url, 'resolution'
        FROM new_for_task
        RETURNING id
      )
      INSERT INTO task_attachment_sources (
        task_attachment_id, source_system, source_storage_url, imported_at, last_checked_at
      )
      SELECT nf.id, ${MISSION_HISTORY_ATTACHMENT_SOURCE_SYSTEM}, nf.source_storage_url, now(), now()
      FROM new_for_task nf
      INNER JOIN inserted_attachments ia ON ia.id = nf.id
      WHERE NOT EXISTS (
        SELECT 1 FROM task_attachment_sources tas
        WHERE tas.source_system = ${MISSION_HISTORY_ATTACHMENT_SOURCE_SYSTEM}
          AND tas.source_storage_url = nf.source_storage_url
      )
      ON CONFLICT (source_system, source_storage_url) DO NOTHING
    `);
  }

  const queries: ReturnType<typeof sql>[] = [];
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const CHUNK = 40;

  async function flushQueries() {
    if (queries.length === 0) return;
    const batch = queries.splice(0, queries.length);
    for (let i = 0; i < batch.length; i += CHUNK) {
      await sql.transaction(batch.slice(i, i + CHUNK));
    }
  }

  try {
    for (const row of classified) {
      if (row.classification === "skip") {
        skipped += 1;
        continue;
      }

      const missionId = row.existingMissionId ?? crypto.randomUUID();
      const description = row.note || row.title;

      if (row.classification === "update") {
        queries.push(sql`
          UPDATE tasks
          SET
            title = ${row.title},
            description = ${description},
            status = ${row.status},
            resolution = ${row.note || null},
            resolved_at = ${row.status === "closed" ? row.closedAt : null}::timestamptz,
            resolved_by_user_id = ${row.status === "closed" ? row.resolvedByUserId : null},
            due_at = ${row.dueAt}::timestamptz,
            updated_at = now()
          WHERE id = ${missionId}
            AND type = 'mission'
        `);
        updated += 1;
      } else {
        queries.push(sql`
          INSERT INTO tasks (
            id, external_id, opened_by_user_id, building_id, task_category_id,
            floor_id, area_id, type, template_task_id, title, description,
            status, resolution, resolved_at, resolved_by_user_id, due_at,
            created_at, updated_at
          )
          VALUES (
            ${missionId}, ${row.externalId}, ${user.id}, ${row.buildingId}, ${row.categoryId},
            ${row.floorId}, ${row.areaId}, 'mission', ${row.templateTaskId}, ${row.title}, ${description},
            ${row.status}, ${row.note || null},
            ${row.status === "closed" ? row.closedAt : null}::timestamptz,
            ${row.status === "closed" ? row.resolvedByUserId : null},
            ${row.dueAt}::timestamptz,
            COALESCE(${row.closedAt}::timestamptz, now()),
            now()
          )
        `);
        created += 1;
      }

      queries.push(sql`
        DELETE FROM task_checklists
        WHERE task_id = ${missionId}
      `);

      for (const [checklistIndex, checklist] of row.checklistGroups.entries()) {
        const { title: checklistTitle, items } = checklist;
        if (items.length === 0) continue;
        const checklistId = crypto.randomUUID();
        const itemIds = items.map(() => crypto.randomUUID());
        queries.push(sql`
          INSERT INTO task_checklists (id, task_id, title, sort_order)
          VALUES (${checklistId}, ${missionId}, ${checklistTitle}, ${checklistIndex})
        `);
        if (checklist.locations.length > 0) {
          queries.push(sql`
            INSERT INTO checklist_locations (
              task_checklist_id, building_id, floor_id, area_id
            )
            SELECT ${checklistId}, x.building_id, x.floor_id, x.area_id
            FROM unnest(
              ${checklist.locations.map((location) => location.buildingId)}::uuid[],
              ${checklist.locations.map((location) => location.floorId)}::uuid[],
              ${checklist.locations.map((location) => location.areaId)}::uuid[]
            ) AS x(building_id, floor_id, area_id)
          `);
        }
        queries.push(sql`
          INSERT INTO task_checklist_items (
            id, task_checklist_id, label, sort_order, item_type,
            is_required, number_unit, number_rule, number_min, number_max,
            options, answer_value, is_completed, completed_at
          )
          SELECT
            x.id, ${checklistId}, x.label, x.sort_order, x.item_type,
            false, x.number_unit,
            CASE WHEN x.item_type = 'number' THEN 'any' ELSE NULL END,
            NULL, NULL,
            x.options::jsonb, x.answer_value, x.is_completed,
            CASE WHEN x.is_completed THEN ${row.closedAt}::timestamptz ELSE NULL END
          FROM unnest(
            ${itemIds}::uuid[],
            ${items.map((item) => item.label)}::text[],
            ${items.map((item) => item.sortOrder)}::int[],
            ${items.map((item) => item.itemType)}::text[],
            ${items.map((item) => item.numberUnit)}::text[],
            ${items.map((item) => JSON.stringify(item.options))}::text[],
            ${items.map((item) => item.answerValue)}::text[],
            ${items.map((item) => item.isCompleted)}::boolean[]
          ) AS x(
            id, label, sort_order, item_type, number_unit, options,
            answer_value, is_completed
          )
        `);
      }

      queueMissionHistoryAttachmentInserts(queries, missionId, row.imageUrls);

      if (queries.length >= CHUNK) {
        await flushQueries();
      }
    }

    await flushQueries();
  } catch (error) {
    await flushQueries().catch(() => undefined);
    const databaseError = error as {
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      message?: unknown;
      severity?: unknown;
      table?: unknown;
    };
    console.error("importMissionHistoryAction write failed", {
      code: databaseError.code,
      constraint: databaseError.constraint,
      created,
      detail: databaseError.detail,
      message: databaseError.message,
      severity: databaseError.severity,
      table: databaseError.table,
      updated,
    });
    return {
      error: dict.admin.uploadImportFailed,
      created,
      updated,
      skipped,
    };
  }

  revalidatePath("/profile");
  revalidatePath("/missions");

  return {
    success: t(dict.superAdmin.missionHistoryUploadSuccess, {
      created,
      updated,
      skipped,
    }),
    created,
    updated,
    skipped,
  };
}

export async function importFileTagsAction(
  rows: FileTagImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.fileTagsUploadEmpty };
  }

  try {
    const buildingId = await resolveBuildingId(user);
    if (!buildingId) {
      return { error: dict.errors.noBuildingAdmin };
    }
    const complexId = await resolveComplexId(buildingId);
    if (!complexId) {
      return { error: dict.files.noBuilding };
    }

    const existing = await sql`
      SELECT id, complex_id, name
      FROM file_tags
      WHERE complex_id = ${complexId}
    `;

    const plan = planFileTagsImport({
      rows,
      complexId,
      existing: existing.map((row) => ({
        id: row.id as string,
        complex_id: row.complex_id as string,
        name: row.name as string,
      })),
    });

    const queries = plan.items.map((item) =>
      item.action === "update"
        ? sql`
            UPDATE file_tags
            SET
              name = ${item.name},
              color = ${item.color}
            WHERE id = ${item.id}
          `
        : sql`
            INSERT INTO file_tags (id, complex_id, name, color)
            VALUES (
              ${item.id},
              ${item.complexId},
              ${item.name},
              ${item.color}
            )
          `,
    );

    const CHUNK = 40;
    for (let i = 0; i < queries.length; i += CHUNK) {
      await sql.transaction(queries.slice(i, i + CHUNK));
    }

    const created = plan.items.filter((item) => item.action === "create").length;
    const updated = plan.items.filter((item) => item.action === "update").length;

    revalidatePath("/profile");
    revalidatePath("/documents");

    return {
      success: t(dict.superAdmin.fileTagsUploadSuccess, {
        create: created,
        update: updated,
      }),
      created,
      updated,
    };
  } catch (error) {
    console.error("importFileTagsAction failed:", error);
    return { error: dict.superAdmin.fileTagsUploadFailed };
  }
}

export async function importFilesAction(
  rows: FileImportRow[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.filesUploadEmpty };
  }

  const [complexes, existing, tags, residents] = await Promise.all([
    sql`SELECT id, name FROM complexes ORDER BY name ASC`,
    sql`SELECT id, complex_id, external_id, title FROM file_series`,
    sql`SELECT id, complex_id, name FROM file_tags`,
    listResidentsForImport(),
  ]);

  const resolved = resolveFileImportRows({
    rows,
    complexes: complexes.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    })),
    existing: existing.map((row) => ({
      id: row.id as string,
      complex_id: row.complex_id as string,
      external_id: (row.external_id as string | null) ?? null,
      title: (row.title as string | null) ?? null,
    })),
    tags: tags.map((row) => ({
      id: row.id as string,
      complex_id: row.complex_id as string,
      name: row.name as string,
    })),
    residents,
  });

  if (!resolved.ok) {
    if (resolved.code === "tag") {
      return {
        error: t(dict.superAdmin.fileTagNotFound, { name: resolved.value }),
      };
    }
    if (resolved.code === "resident") {
      return {
        error: t(dict.superAdmin.fileResidentNotFound, { name: resolved.value }),
      };
    }
    return {
      error: t(dict.superAdmin.complexNotFound, { name: resolved.value }),
    };
  }

  let created = 0;
  let updated = 0;

  try {
    for (const item of resolved.items) {
      if (item.action === "update") {
        await sql`
          UPDATE file_series
          SET
            external_id = ${item.externalId},
            title = ${item.title},
            tag_id = ${item.tagId},
            resident_id = COALESCE(${item.residentId}, resident_id)
          WHERE id = ${item.id}
        `;
        updated += 1;
      } else {
        await sql`
          INSERT INTO file_series (id, complex_id, external_id, title, tag_id, resident_id)
          VALUES (
            ${item.id},
            ${item.complexId},
            ${item.externalId},
            ${item.title},
            ${item.tagId},
            ${item.residentId}
          )
        `;
        created += 1;
      }
    }
  } catch (error) {
    console.error("importFilesAction failed:", error);
    return { error: dict.superAdmin.filesUploadFailed };
  }

  revalidatePath("/profile");
  revalidatePath("/documents");

  const success =
    updated > 0
      ? t(dict.superAdmin.filesUploadSuccessDetailed, { created, updated })
      : t(dict.superAdmin.filesUploadSuccess, { create: created, update: 0 });

  return {
    success,
    created,
    updated,
  };
}

type FileAttachmentImportContext = {
  complexId: string;
  existingSeries: { id: string; title: string; external_id: string | null }[];
  existingVersions: {
    id: string;
    series_id: string;
    version: number;
    file_external_id: string | null;
  }[];
  existingAttachments: {
    series_id: string;
    file_id: string;
    file_name: string;
    mime_type: string;
    storage_url: string;
    external_id: string | null;
  }[];
  tags: { id: string; complex_id: string; name: string }[];
  residents: { id: string; complex_id: string; display_name: string }[];
  users: { id: string; complex_id: string; full_name: string }[];
};

async function loadFileAttachmentImportContext(
  complexId: string,
): Promise<{ error?: string; context?: FileAttachmentImportContext }> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const parsedComplexId = z.string().uuid().safeParse(complexId);
  if (!parsedComplexId.success) {
    return { error: dict.admin.complexNotFound };
  }

  const [complex] = await sql`
    SELECT id FROM complexes WHERE id = ${parsedComplexId.data} LIMIT 1
  `;
  if (!complex) {
    return { error: dict.admin.complexNotFound };
  }

  const [existingSeries, existingVersions, existingAttachments, tags, residents, users] =
    await Promise.all([
      sql`
        SELECT id, title, external_id
        FROM file_series
        WHERE complex_id = ${parsedComplexId.data}
          AND external_id IS NOT NULL
      `,
      sql`
        SELECT f.id, f.series_id, f.version, f.external_id AS file_external_id
        FROM files f
        INNER JOIN file_series fs ON fs.id = f.series_id
        WHERE fs.complex_id = ${parsedComplexId.data}
      `,
      sql`
        SELECT
          f.series_id,
          fa.file_id,
          fa.file_name,
          fa.mime_type,
          fa.storage_url,
          f.external_id
        FROM file_attachments fa
        INNER JOIN files f ON f.id = fa.file_id
        INNER JOIN file_series fs ON fs.id = f.series_id
        WHERE fs.complex_id = ${parsedComplexId.data}
          AND f.external_id IS NOT NULL
        ORDER BY fa.created_at ASC
      `,
      sql`
        SELECT id, complex_id, name
        FROM file_tags
        WHERE complex_id = ${parsedComplexId.data}
      `,
      listResidentsForImport(),
      usersSql`
        SELECT DISTINCT u.id, u.full_name, ucp.complex_id
        FROM users u
        INNER JOIN user_complex_permissions ucp ON ucp.user_id = u.id
        WHERE ucp.complex_id = ${parsedComplexId.data}
      `,
    ]);

  return {
    context: {
      complexId: parsedComplexId.data,
      existingSeries: existingSeries.map((row) => ({
        id: row.id as string,
        title: row.title as string,
        external_id: (row.external_id as string | null) ?? null,
      })),
      existingVersions: existingVersions.map((row) => ({
        id: row.id as string,
        series_id: row.series_id as string,
        version: Number(row.version),
        file_external_id: (row.file_external_id as string | null) ?? null,
      })),
      existingAttachments: existingAttachments.map((row) => ({
        series_id: row.series_id as string,
        file_id: row.file_id as string,
        file_name: row.file_name as string,
        mime_type: row.mime_type as string,
        storage_url: row.storage_url as string,
        external_id: (row.external_id as string | null) ?? null,
      })),
      tags: tags.map((row) => ({
        id: row.id as string,
        complex_id: row.complex_id as string,
        name: row.name as string,
      })),
      residents,
      users: users.map((row) => ({
        id: row.id as string,
        complex_id: row.complex_id as string,
        full_name: row.full_name as string,
      })),
    },
  };
}

function resolveFileAttachmentsForImport(
  rows: FileAttachmentImportDocument[],
  context: FileAttachmentImportContext,
) {
  return resolveFileAttachmentImportRows({
    rows,
    complexId: context.complexId,
    existingSeries: context.existingSeries,
    existingVersions: context.existingVersions,
    existingAttachments: context.existingAttachments,
    tags: context.tags,
    residents: context.residents,
    users: context.users,
  });
}

export async function previewFileAttachmentsImportAction(
  complexId: string,
  rows: FileAttachmentImportDocument[],
): Promise<{
  error?: string;
  items?: Array<{
    rowNumber: number;
    externalId: string;
    title: string;
    version: number;
    action: "create" | "update" | "skip";
    uploadCount: number;
    skipCount: number;
    reuseCount: number;
  }>;
}> {
  const [dict] = await Promise.all([getDictionary()]);
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.fileAttachmentsUploadEmpty };
  }

  const loaded = await loadFileAttachmentImportContext(complexId);
  if (loaded.error || !loaded.context) {
    return { error: loaded.error };
  }

  const resolved = resolveFileAttachmentsForImport(rows, loaded.context);
  if (!resolved.ok) {
    if (resolved.code === "user") {
      return {
        error: t(dict.superAdmin.userNotFound, { name: resolved.value }),
      };
    }
    if (resolved.code === "series") {
      return {
        error: t(dict.superAdmin.fileSeriesNotFound, {
          name: resolved.value,
        }),
      };
    }
    return {
      error: t(dict.superAdmin.fileResidentNotFound, { name: resolved.value }),
    };
  }

  return {
    items: resolved.items.map((item) => {
      const uploadCount = item.attachments.filter(
        (attachment) => !attachment.alreadyOnFile && !attachment.reuse,
      ).length;
      const skipCount = item.attachments.filter(
        (attachment) => attachment.alreadyOnFile,
      ).length;
      const reuseCount = item.attachments.filter(
        (attachment) => !attachment.alreadyOnFile && attachment.reuse,
      ).length;

      let action: "create" | "update" | "skip";
      if (item.action === "create") {
        action = "create";
      } else if (uploadCount === 0 && reuseCount === 0 && skipCount > 0) {
        action = "skip";
      } else {
        action = "update";
      }

      return {
        rowNumber: item.rowNumber,
        externalId: item.externalId,
        title: item.title,
        version: item.version,
        action,
        uploadCount,
        skipCount,
        reuseCount,
      };
    }),
  };
}

export async function importFileAttachmentsAction(
  complexId: string,
  rows: FileAttachmentImportDocument[],
): Promise<{
  error?: string;
  success?: string;
  created?: number;
  updated?: number;
}> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: dict.superAdmin.fileAttachmentsUploadEmpty };
  }

  const loaded = await loadFileAttachmentImportContext(complexId);
  if (loaded.error || !loaded.context) {
    return { error: loaded.error };
  }

  const resolved = resolveFileAttachmentsForImport(rows, loaded.context);

  if (!resolved.ok) {
    if (resolved.code === "user") {
      return {
        error: t(dict.superAdmin.userNotFound, { name: resolved.value }),
      };
    }
    if (resolved.code === "series") {
      return {
        error: t(dict.superAdmin.fileSeriesNotFound, {
          name: resolved.value,
        }),
      };
    }
    return {
      error: t(dict.superAdmin.fileResidentNotFound, { name: resolved.value }),
    };
  }

  const nonCloudinaryUrl = resolved.items
    .flatMap((item) => item.attachments)
    .map((attachment) => attachment.storageUrl)
    .find((url) => url && !isCloudinaryStorageUrl(url));
  if (nonCloudinaryUrl) {
    return {
      error: t(dict.superAdmin.fileAttachmentsNotCloudinary, {
        url: nonCloudinaryUrl,
      }),
    };
  }

  let created = 0;
  let updated = 0;

  const attachmentUpload = await uploadImportUrlsBySource(
    resolved.items.flatMap((item) =>
      item.attachments
        .filter((attachment) => !attachment.alreadyOnFile && !attachment.reuse)
        .map((attachment) => attachment.storageUrl),
    ),
    dict,
  );
  if (!attachmentUpload.ok) {
    return { error: attachmentUpload.error };
  }
  const uploadedBySource = attachmentUpload.bySource;

  try {
    for (const item of resolved.items) {
      const attachmentsToUpload = item.attachments.filter(
        (attachment) => !attachment.alreadyOnFile && !attachment.reuse,
      );
      const attachmentsToReuse = item.attachments.filter(
        (attachment) => !attachment.alreadyOnFile && attachment.reuse,
      );

      const queries: ReturnType<typeof sql>[] = [];
      if (item.seriesAction === "create") {
        queries.push(sql`
          INSERT INTO file_series (id, complex_id, external_id, title, tag_id, resident_id)
          VALUES (${item.seriesId}, ${item.complexId}, ${item.externalId}, ${item.title}, ${item.tagId}, ${item.residentId})
        `);
      } else {
        queries.push(sql`
          UPDATE file_series
          SET
            tag_id = COALESCE(${item.tagId}, tag_id),
            resident_id = COALESCE(${item.residentId}, resident_id)
          WHERE id = ${item.seriesId}
            AND complex_id = ${item.complexId}
        `);
      }

      if (item.action === "update") {
        queries.push(sql`
          UPDATE files
          SET
            start_date = ${item.startDate},
            expiration_date = ${item.expirationDate},
            created_by_user_id = COALESCE(
              ${item.createdByUserId}::uuid,
              created_by_user_id
            ),
            external_id = COALESCE(${item.fileExternalId}, external_id),
            updated_at = now()
          WHERE id = ${item.id}
            AND series_id = ${item.seriesId}
        `);
      } else {
        queries.push(sql`
          INSERT INTO files (
            id,
            series_id,
            version,
            start_date,
            expiration_date,
            created_by_user_id,
            created_at,
            external_id
          )
          SELECT
            ${item.id},
            fs.id,
            ${item.version},
            ${item.startDate},
            ${item.expirationDate},
            ${item.createdByUserId}::uuid,
            COALESCE(${item.createdAt}::timestamptz, now()),
            ${item.fileExternalId}
          FROM file_series fs
          WHERE fs.id = ${item.seriesId}
            AND fs.complex_id = ${item.complexId}
        `);
      }

      await sql.transaction(queries);

      if (item.action === "update") updated += 1;
      else created += 1;

      const copiedAttachments = [
        ...attachmentsToReuse.flatMap((attachment) => {
          if (!attachment.reuse || isForeignCloudinaryUrl(attachment.reuse.storage_url)) {
            return [];
          }
          return [
            {
              file_name: attachment.reuse.file_name,
              mime_type: attachment.reuse.mime_type,
              storage_url: attachment.reuse.storage_url,
              external_id: attachment.externalId,
            },
          ];
        }),
        ...attachmentsToUpload.flatMap((source) => {
          const file = uploadedBySource.get(source.storageUrl);
          if (!file || isForeignCloudinaryUrl(file.storage_url)) return [];
          return [
            {
              file_name: source.fileName || file.file_name,
              mime_type: source.mimeType || file.mime_type,
              storage_url: file.storage_url,
              external_id:
                source.externalId ??
                cloudinaryPublicIdFromSource(
                  source.storageUrl,
                  source.fileName ?? file.file_name,
                ),
            },
          ];
        }),
      ];

      if (copiedAttachments.length > 0) {
        const fileNames = copiedAttachments.map((file) => file.file_name);
        const mimeTypes = copiedAttachments.map((file) => file.mime_type);
        const storageUrls = copiedAttachments.map((file) => file.storage_url);
        await sql`
          INSERT INTO file_attachments (
            file_id, file_name, mime_type, storage_url
          )
          SELECT ${item.id}, x.file_name, x.mime_type, x.storage_url
          FROM unnest(
            ${fileNames}::text[],
            ${mimeTypes}::text[],
            ${storageUrls}::text[]
          ) AS x(file_name, mime_type, storage_url)
          WHERE NOT EXISTS (
            SELECT 1
            FROM file_attachments fa
            WHERE fa.file_id = ${item.id}
              AND (
                fa.file_name = x.file_name
                OR fa.storage_url = x.storage_url
              )
          )
        `;
      }
    }
  } catch (error) {
    console.error("importFileAttachmentsAction failed:", error);
    return { error: dict.superAdmin.fileAttachmentsUploadFailed };
  }

  revalidatePath("/profile");
  revalidatePath("/documents");

  const success =
    updated > 0
      ? t(dict.superAdmin.fileAttachmentsUploadSuccessDetailed, {
          created,
          updated,
        })
      : t(dict.superAdmin.fileAttachmentsUploadSuccess, {
          create: created,
          update: 0,
        });

  return {
    success,
    created,
    updated,
  };
}
