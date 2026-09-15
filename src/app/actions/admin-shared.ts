"use server";

// importAreasAction and importEquipmentAction are duplicated (function bodies
// copied verbatim) from with_robust_app's src/app/actions/admin.ts, because
// that file's much larger "/admin" complex-manager area is not being ported
// to this app. Only these two entry points — reused by this app's
// super-admin.ts (areas) and building-upload-panels.tsx (equipment) — are
// needed here. The two local admin.ts helpers they depended on
// (requireBuildingWriteAdmin, requireAdminUser) are reproduced below,
// simplified for the fact that every user of this app is a super_admin (the
// non-super_admin / complex-admin branches from the source were dead code
// for that case and have been dropped, not altered).
//
// Keep in sync manually if with_robust_app's admin.ts changes these two
// functions.

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import {
  getAccessibleBuildings,
  getAdminBuildingIds,
  userCanAccessBuilding,
} from "@/lib/building";
import { isAllBuildingsId } from "@/lib/building-shared";
import { sql } from "@/lib/db";
import { getDictionary } from "@/i18n/get-dictionary";
import { t } from "@/i18n/t";
import { resolveEquipmentConditionId } from "@/lib/equipment-condition";
import { resolveEquipmentTypeId } from "@/lib/equipment-types";
import { getEquipmentTypes } from "@/lib/equipment-types-db";
import {
  planAreasImport,
  resolveExistingEquipmentLocation,
  type AreaImportRow,
} from "@/lib/area-import";

async function requireAdminUser() {
  const [dict, user] = await Promise.all([getDictionary(), requireUser()]);
  return { error: null, user, dict };
}

async function requireBuildingWriteAdmin(buildingId: string) {
  const [dict, user] = await Promise.all([getDictionary(), requireUser()]);

  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized, user: null, buildingId: null, dict };
  }

  const parsedId = z.string().uuid().safeParse(buildingId);
  if (!parsedId.success) {
    return { error: dict.errors.invalidInput, user: null, buildingId: null, dict };
  }

  return { error: null, user, buildingId: parsedId.data, dict };
}

type AreaImportResult = {
  error?: string;
  success?: string;
  areas?: {
    id: string;
    name: string;
    floor_id: string | null;
    parent_area_id: string | null;
    area_type?: string | null;
    qr_code?: string | null;
  }[];
  created?: number;
  updated?: number;
  skipped?: number;
};


export async function importAreasAction(
  buildingId: string,
  rows: AreaImportRow[],
  options?: { skipExisting?: boolean },
): Promise<AreaImportResult> {
  const ctx = await requireBuildingWriteAdmin(buildingId);
  if (ctx.error || !ctx.buildingId) {
    return { error: ctx.error ?? ctx.dict.errors.unauthorized };
  }

  try {
    const [buildingRows, floorRows, areaRows] = await Promise.all([
      sql`
        SELECT id, name
        FROM buildings
        WHERE id = ${ctx.buildingId}
        LIMIT 1
      `,
      sql`
        SELECT id, name, number
        FROM floors
        WHERE building_id = ${ctx.buildingId}
        ORDER BY number DESC, name ASC
      `,
      sql`
        SELECT
          id,
          name,
          floor_id,
          parent_area_id,
          external_id,
          area_type,
          qr_code
        FROM areas
        WHERE building_id = ${ctx.buildingId}
      `,
    ]);

    const buildingName = String(buildingRows[0]?.name ?? "");
    const existingByExternalId = new Map(
      areaRows
        .filter((row) => String(row.external_id ?? "").trim())
        .map((row) => [
          String(row.external_id).trim().toLocaleLowerCase(),
          row,
        ]),
    );
    const nameUpdates = new Map<string, { id: string; name: string }>();
    if (options?.skipExisting) {
      for (const row of rows) {
        const existing = existingByExternalId.get(
          row.externalId.trim().toLocaleLowerCase(),
        );
        if (existing && String(existing.name).trim() !== row.name.trim()) {
          nameUpdates.set(existing.id as string, {
            id: existing.id as string,
            name: row.name.trim(),
          });
        }
      }
    }
    const rowsToImport = options?.skipExisting
      ? rows.filter(
          (row) =>
            !existingByExternalId.has(row.externalId.trim().toLocaleLowerCase()),
        )
      : rows;
    const plan = planAreasImport({
      rows: rowsToImport,
      floors: floorRows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        number: Number(row.number),
      })),
      areas: areaRows.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        floor_id: (row.floor_id as string | null) ?? null,
        parent_area_id: (row.parent_area_id as string | null) ?? null,
        external_id: (row.external_id as string | null) ?? null,
        area_type: (row.area_type as string | null) ?? null,
        qr_code: (row.qr_code as string | null) ?? null,
      })),
      buildingName,
      matchExistingByExternalIdOnly: options?.skipExisting,
    });

    // Rows that failed to resolve (e.g. an unknown floor) are already
    // excluded from plan.items/createdParents — they're skipped rather than
    // blocking the rows that did resolve.
    const skipped = plan.issues.length;

    const operationsById = new Map<string, (typeof plan.items)[number]>();
    for (const item of plan.createdParents) {
      operationsById.set(item.areaId, item);
    }
    for (const item of plan.items) {
      const previous = operationsById.get(item.areaId);
      if (!previous) {
        operationsById.set(item.areaId, item);
        continue;
      }
      operationsById.set(item.areaId, {
        ...previous,
        ...item,
        // Keep a single create for parent stubs that are later filled by a leaf row.
        action: previous.action === "create" ? "create" : item.action,
        parentChain: previous.parentChain,
      });
    }

    const operations = [...operationsById.values()]
      .filter((item) => !options?.skipExisting || item.action === "create")
      .sort((a, b) => a.parentChain.length - b.parentChain.length);

    if (operations.length === 0 && nameUpdates.size === 0) {
      return {
        success: ctx.dict.admin.areasUploaded.replace("{count}", "0"),
        areas: [],
        created: 0,
        updated: 0,
        skipped,
      };
    }

    const queries = [
      ...[...nameUpdates.values()].map((item) => sql`
        UPDATE areas
        SET name = ${item.name}
        WHERE id = ${item.id}
          AND building_id = ${ctx.buildingId}
        RETURNING id, name, floor_id, parent_area_id, external_id, area_type, qr_code
      `),
      ...operations.map((item) => {
      if (item.action === "update") {
        return sql`
          UPDATE areas
          SET
            name = ${item.name},
            building_id = ${ctx.buildingId},
            floor_id = ${item.parentAreaId ? null : item.floorId},
            parent_area_id = ${item.parentAreaId},
            external_id = ${item.externalId},
            area_type = ${item.type},
            qr_code = COALESCE(areas.qr_code, ${item.qrCode})
          WHERE id = ${item.areaId}
          RETURNING id, name, floor_id, parent_area_id, external_id, area_type, qr_code
        `;
      }
      return sql`
        INSERT INTO areas (
          id,
          name,
          building_id,
          floor_id,
          parent_area_id,
          external_id,
          area_type,
          qr_code
        )
        VALUES (
          ${item.areaId},
          ${item.name},
          ${ctx.buildingId},
          ${item.parentAreaId ? null : item.floorId},
          ${item.parentAreaId},
          ${item.externalId},
          ${item.type},
          ${item.qrCode}
        )
        RETURNING id, name, floor_id, parent_area_id, external_id, area_type, qr_code
      `;
      }),
    ];

    const results = await sql.transaction(queries);
    const areas = results.flat().map((row) => ({
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      parent_area_id: (row.parent_area_id as string | null) ?? null,
      area_type: (row.area_type as string | null) ?? null,
      qr_code: (row.qr_code as string | null) ?? null,
    }));

    const created = operations.filter((item) => item.action === "create").length;
    const updated =
      nameUpdates.size + operations.filter((item) => item.action === "update").length;

    revalidatePath("/buildings");
    return {
      success:
        updated > 0
          ? ctx.dict.admin.areasUploadedMixed
              .replace("{create}", String(created))
              .replace("{update}", String(updated))
          : ctx.dict.admin.areasUploaded.replace("{count}", String(created)),
      areas,
      created,
      updated,
      skipped,
    };
  } catch (error) {
    console.error("importAreasAction failed:", error);
    return { error: ctx.dict.admin.areasUploadInvalid };
  }
}

type EquipmentAdvancedFields = {
  serialNumber: string | null;
  model: string | null;
  manufacturer: string | null;
  condition: string | null;
  estimatedLifespanYears: number | null;
  installationDate: string | null;
  replacementCost: number | null;
  installationCost: number | null;
  warrantyExpirationDate: string | null;
};

function parseEquipmentAdvancedFields(
  input: FormData | Record<string, string | undefined>,
): { error: string } | { data: EquipmentAdvancedFields } {
  const get = (key: string) =>
    input instanceof FormData
      ? String(input.get(key) ?? "").trim()
      : (input[key] ?? "").trim();

  const conditionRaw = get("condition");
  const condition = resolveEquipmentConditionId(conditionRaw);
  if (conditionRaw && !condition) {
    return { error: "invalid" };
  }

  const lifespanRaw = get("estimated_lifespan_years");
  let estimatedLifespanYears: number | null = null;
  if (lifespanRaw) {
    const value = Number(lifespanRaw);
    if (!Number.isFinite(value) || value < 0) return { error: "invalid" };
    estimatedLifespanYears = Math.round(value);
  }

  const replacementCostRaw = get("replacement_cost");
  let replacementCost: number | null = null;
  if (replacementCostRaw) {
    const value = Number(replacementCostRaw);
    if (!Number.isFinite(value) || value < 0) return { error: "invalid" };
    replacementCost = value;
  }

  const installationCostRaw = get("installation_cost");
  let installationCost: number | null = null;
  if (installationCostRaw) {
    const value = Number(installationCostRaw);
    if (!Number.isFinite(value) || value < 0) return { error: "invalid" };
    installationCost = value;
  }

  return {
    data: {
      serialNumber: get("serial_number") || null,
      model: get("model") || null,
      manufacturer: get("manufacturer") || null,
      condition,
      estimatedLifespanYears,
      installationDate: get("installation_date") || null,
      replacementCost,
      installationCost,
      warrantyExpirationDate: get("warranty_expiration_date") || null,
    },
  };
}

export async function importEquipmentAction(
  defaultBuildingId: string | null,
  rows: Array<{
    rowNumber?: number;
    name: string;
    areaName: string;
    building?: string;
    description?: string;
    equipmentType?: string;
    externalId?: string;
    qrCode?: string;
    serialNumber?: string;
    model?: string;
    manufacturer?: string;
    condition?: string;
    estimatedLifespanYears?: string;
    installationDate?: string;
    replacementCost?: string;
    installationCost?: string;
    warrantyExpirationDate?: string;
  }>,
  options?: { externalIdOnly?: boolean; previewOnly?: boolean },
): Promise<{
  error?: string;
  success?: string;
  equipment?: Array<{
    id: string;
    name: string;
    floor_id: string | null;
    area_id: string | null;
    equipment_type?: string | null;
    description?: string | null;
    external_id?: string | null;
    qr_code?: string | null;
    building_id?: string;
    building_name?: string;
    serial_number?: string | null;
    model?: string | null;
    manufacturer?: string | null;
    condition?: string | null;
    estimated_lifespan_years?: number | null;
    installation_date?: string | null;
    replacement_cost?: number | null;
    installation_cost?: number | null;
    warranty_expiration_date?: string | null;
  }>;
  created?: number;
  updated?: number;
  skipped?: number;
  preview?: Array<{
    key: string;
    label: string;
    detail: string;
    action: "create" | "update" | "skip" | "error";
  }>;
}> {
  const ctx = await requireAdminUser();
  if (ctx.error || !ctx.user) {
    return { error: ctx.error ?? "Unauthorized" };
  }

  const dict = ctx.dict;

  function rowError(rowNumber: number | undefined, message: string) {
    if (rowNumber == null || !Number.isFinite(rowNumber)) return message;
    return t(dict.admin.equipmentUploadRowError, {
      row: rowNumber,
      message,
    });
  }

  function formatLocationError(message: string) {
    const areaPrefix = "Area not found: ";
    if (message.startsWith(areaPrefix)) {
      return t(dict.admin.equipmentUploadAreaNotFound, {
        name: message.slice(areaPrefix.length),
      });
    }
    const floorPrefix = "Floor not found: ";
    if (message.startsWith(floorPrefix)) {
      return t(dict.admin.equipmentUploadFloorNotFound, {
        name: message.slice(floorPrefix.length).replace(/\.$/, ""),
      });
    }
    const locationPrefix = "Location not found: ";
    if (message.startsWith(locationPrefix)) {
      const name = message.slice(locationPrefix.length);
      if (name === "(empty)") return dict.errors.selectLocation;
      return t(dict.admin.equipmentUploadLocationNotFound, { name });
    }
    return message;
  }

  const rowsSchema = z.array(
    z.object({
      rowNumber: z.number().int().positive().optional(),
      name: z.string().trim().min(1),
      areaName: z.string().trim(),
      building: z.string().trim().optional(),
      description: z.string().trim().optional(),
      equipmentType: z.string().trim().optional(),
      externalId: z.string().trim().optional(),
      qrCode: z.string().trim().optional(),
      serialNumber: z.string().trim().optional(),
      model: z.string().trim().optional(),
      manufacturer: z.string().trim().optional(),
      condition: z.string().trim().optional(),
      estimatedLifespanYears: z.string().trim().optional(),
      installationDate: z.string().trim().optional(),
      replacementCost: z.string().trim().optional(),
      installationCost: z.string().trim().optional(),
      warrantyExpirationDate: z.string().trim().optional(),
    }),
  );
  const parsed = rowsSchema.safeParse(rows);
  if (!parsed.success) {
    return { error: dict.errors.invalidInput };
  }
  if (parsed.data.length === 0) {
    return {
      success: dict.admin.equipmentUploaded.replace("{count}", "0"),
      equipment: [],
      created: 0,
      updated: 0,
    };
  }

  const adminBuildingIds = new Set(await getAdminBuildingIds(ctx.user));
  const accessibleBuildings = (await getAccessibleBuildings(ctx.user)).filter(
    (building) => adminBuildingIds.has(building.id),
  );
  if (accessibleBuildings.length === 0) {
    return { error: dict.errors.noBuildingAdmin };
  }

  const equipmentTypes = await getEquipmentTypes();

  const buildingsByName = new Map(
    accessibleBuildings.map((building) => [
      building.name.trim().toLowerCase(),
      building,
    ]),
  );

  const fallbackBuildingId =
    defaultBuildingId &&
    !isAllBuildingsId(defaultBuildingId) &&
    z.string().uuid().safeParse(defaultBuildingId).success
      ? defaultBuildingId
      : null;

  if (fallbackBuildingId) {
    const allowed = accessibleBuildings.some(
      (building) => building.id === fallbackBuildingId,
    );
    if (!allowed) {
      return { error: ctx.dict.errors.buildingNotAllowed };
    }
  }

  type ResolvedRow = {
    rowNumber: number;
    name: string;
    areaName: string;
    buildingId: string;
    buildingName: string;
    description: string | null;
    equipmentType: string | null;
    externalId: string | null;
    qrCode: string | null;
    serialNumber: string | null;
    model: string | null;
    manufacturer: string | null;
    condition: string | null;
    estimatedLifespanYears: number | null;
    installationDate: string | null;
    replacementCost: number | null;
    installationCost: number | null;
    warrantyExpirationDate: string | null;
  };

  // Rows that fail to resolve (unknown building, missing floor/area, bad
  // field, ...) are skipped rather than aborting the whole import — the
  // client shows them as red "won't upload" preview rows and the admin
  // confirms before the rest goes through.
  const rowIssues: { rowNumber: number; message: string }[] = [];
  const rowNames = new Map(
    parsed.data.map((row, index) => [row.rowNumber ?? index + 2, row.name]),
  );

  const resolvedRows: ResolvedRow[] = [];
  for (const [index, row] of parsed.data.entries()) {
    const rowNumber = row.rowNumber ?? index + 2;
    const buildingName = row.building?.trim() ?? "";
    let buildingId: string;
    let resolvedBuildingName: string;

    if (buildingName) {
      const match = buildingsByName.get(buildingName.toLowerCase());
      if (!match) {
        rowIssues.push({
          rowNumber,
          message: t(dict.admin.equipmentUploadBuildingNotFound, {
            name: buildingName,
          }),
        });
        continue;
      }
      if (!(await userCanAccessBuilding(ctx.user, match.id))) {
        rowIssues.push({ rowNumber, message: ctx.dict.errors.buildingNotAllowed });
        continue;
      }
      buildingId = match.id;
      resolvedBuildingName = match.name;
    } else if (fallbackBuildingId) {
      const fallback = accessibleBuildings.find(
        (building) => building.id === fallbackBuildingId,
      );
      if (!fallback) {
        rowIssues.push({ rowNumber, message: ctx.dict.errors.buildingNotAllowed });
        continue;
      }
      buildingId = fallback.id;
      resolvedBuildingName = fallback.name;
    } else {
      rowIssues.push({
        rowNumber,
        message: ctx.dict.admin.equipmentUploadBuildingRequired,
      });
      continue;
    }

    const typeRaw = row.equipmentType?.trim() ?? "";
    const equipmentType = resolveEquipmentTypeId(equipmentTypes, typeRaw);
    if (typeRaw && !equipmentType) {
      rowIssues.push({ rowNumber, message: ctx.dict.errors.selectEquipmentType });
      continue;
    }

    const advanced = parseEquipmentAdvancedFields({
      condition: row.condition,
      estimated_lifespan_years: row.estimatedLifespanYears,
      replacement_cost: row.replacementCost,
      installation_cost: row.installationCost,
      serial_number: row.serialNumber,
      model: row.model,
      manufacturer: row.manufacturer,
      installation_date: row.installationDate,
      warranty_expiration_date: row.warrantyExpirationDate,
    });
    if ("error" in advanced) {
      rowIssues.push({ rowNumber, message: dict.errors.invalidInput });
      continue;
    }

    resolvedRows.push({
      rowNumber,
      name: row.name.trim(),
      areaName: row.areaName.trim(),
      buildingId,
      buildingName: resolvedBuildingName,
      description: row.description?.trim() || null,
      equipmentType,
      externalId: row.externalId?.trim() || null,
      qrCode: row.qrCode?.trim() || null,
      serialNumber: advanced.data.serialNumber,
      model: advanced.data.model,
      manufacturer: advanced.data.manufacturer,
      condition: advanced.data.condition,
      estimatedLifespanYears: advanced.data.estimatedLifespanYears,
      installationDate: advanced.data.installationDate,
      replacementCost: advanced.data.replacementCost,
      installationCost: advanced.data.installationCost,
      warrantyExpirationDate: advanced.data.warrantyExpirationDate,
    });
  }

  const buildingIds = [...new Set(resolvedRows.map((row) => row.buildingId))];

  const [floorRows, areaRows, equipmentRows] = await Promise.all([
    sql`
      SELECT id, name, number, building_id
      FROM floors
      WHERE building_id = ANY(${buildingIds})
      ORDER BY number DESC, name ASC
    `,
    sql`
      SELECT id, name, floor_id, parent_area_id, building_id
      FROM areas
      WHERE building_id = ANY(${buildingIds})
    `,
    sql`
      SELECT
        e.id,
        e.name,
        e.floor_id,
        e.area_id,
        e.external_id,
        COALESCE(e.building_id, f.building_id, a.building_id) AS building_id,
        COALESCE(bf.name, ba.name, eb.name) AS building_name
      FROM equipment e
      LEFT JOIN floors f ON f.id = e.floor_id
      LEFT JOIN areas a ON a.id = e.area_id
      LEFT JOIN buildings bf ON bf.id = f.building_id
      LEFT JOIN buildings ba ON ba.id = a.building_id
      LEFT JOIN buildings eb ON eb.id = e.building_id
      WHERE COALESCE(e.building_id, f.building_id, a.building_id) = ANY(${buildingIds})
    `,
  ]);

  const floors = floorRows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    number: Number(row.number),
    building_id: row.building_id as string,
  }));
  const areas = areaRows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    floor_id: (row.floor_id as string | null) ?? null,
    parent_area_id: (row.parent_area_id as string | null) ?? null,
    building_id: row.building_id as string,
  }));

  function matchName(a: string, b: string) {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }

  type PlannedOp = {
    action: "create" | "update" | "skip";
    id: string;
    rowNumber: number;
    areaName: string;
    name: string;
    floorId: string | null;
    areaId: string | null;
    buildingId: string;
    buildingName: string;
    description: string | null;
    equipmentType: string | null;
    externalId: string | null;
    qrCode: string | null;
    serialNumber: string | null;
    model: string | null;
    manufacturer: string | null;
    condition: string | null;
    estimatedLifespanYears: number | null;
    installationDate: string | null;
    replacementCost: number | null;
    installationCost: number | null;
    warrantyExpirationDate: string | null;
    previousName?: string;
    nameOnly?: boolean;
  };

  const planned: PlannedOp[] = [];
  const claimedIds = new Set<string>();
  let working = equipmentRows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    floor_id: (row.floor_id as string | null) ?? null,
    area_id: (row.area_id as string | null) ?? null,
    external_id: (row.external_id as string | null) ?? null,
    building_id: row.building_id as string,
    building_name: row.building_name as string,
  }));

  for (const row of resolvedRows) {
    const existingByExternalId = row.externalId
      ? working.find(
          (item) =>
            item.building_id === row.buildingId &&
            (item.external_id ?? "").trim().toLowerCase() ===
              row.externalId!.toLowerCase(),
        )
      : undefined;

    if (options?.externalIdOnly && existingByExternalId) {
      const nameChanged = existingByExternalId.name.trim() !== row.name.trim();
      claimedIds.add(existingByExternalId.id);
      planned.push({
        action: nameChanged ? "update" : "skip",
        id: existingByExternalId.id,
        rowNumber: row.rowNumber,
        areaName: row.areaName,
        name: row.name,
        floorId: existingByExternalId.floor_id,
        areaId: existingByExternalId.area_id,
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        description: row.description,
        equipmentType: row.equipmentType,
        externalId: row.externalId,
        qrCode: row.qrCode,
        serialNumber: row.serialNumber,
        model: row.model,
        manufacturer: row.manufacturer,
        condition: row.condition,
        estimatedLifespanYears: row.estimatedLifespanYears,
        installationDate: row.installationDate,
        replacementCost: row.replacementCost,
        installationCost: row.installationCost,
        warrantyExpirationDate: row.warrantyExpirationDate,
        previousName: existingByExternalId.name,
        nameOnly: true,
      });
      working = working.map((item) =>
        item.id === existingByExternalId.id ? { ...item, name: row.name } : item,
      );
      continue;
    }

    const floorsForBuilding = floors
      .filter((item) => item.building_id === row.buildingId)
      .map((item) => ({
        id: item.id,
        name: item.name,
        number: item.number,
      }));
    const areasForBuilding = areas.filter(
      (item) => item.building_id === row.buildingId,
    );

    const location = resolveExistingEquipmentLocation(
      row.areaName,
      floorsForBuilding,
      areasForBuilding,
      row.buildingName,
      row.name,
    );
    if (!location.ok) {
      rowIssues.push({
        rowNumber: row.rowNumber,
        message: formatLocationError(location.message),
      });
      continue;
    }

    const floorId = location.floorId;
    const areaId = location.areaId;

    const existing =
      existingByExternalId ??
      (!options?.externalIdOnly ? working.find(
        (item) =>
          !claimedIds.has(item.id) &&
          item.building_id === row.buildingId &&
          matchName(item.name, row.name) &&
          (item.floor_id ?? null) === floorId &&
          (item.area_id ?? null) === areaId,
      ) : undefined);

    if (existing) {
      claimedIds.add(existing.id);
      planned.push({
        action: "update",
        id: existing.id,
        rowNumber: row.rowNumber,
        areaName: row.areaName,
        name: row.name,
        floorId,
        areaId,
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        description: row.description,
        equipmentType: row.equipmentType,
        externalId: row.externalId,
        qrCode: row.qrCode,
        serialNumber: row.serialNumber,
        model: row.model,
        manufacturer: row.manufacturer,
        condition: row.condition,
        estimatedLifespanYears: row.estimatedLifespanYears,
        installationDate: row.installationDate,
        replacementCost: row.replacementCost,
        installationCost: row.installationCost,
        warrantyExpirationDate: row.warrantyExpirationDate,
      });
      working = working.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              name: row.name,
              floor_id: floorId,
              area_id: areaId,
              external_id: row.externalId,
            }
          : item,
      );
    } else {
      const id = crypto.randomUUID();
      claimedIds.add(id);
      planned.push({
        action: "create",
        id,
        rowNumber: row.rowNumber,
        areaName: row.areaName,
        name: row.name,
        floorId,
        areaId,
        buildingId: row.buildingId,
        buildingName: row.buildingName,
        description: row.description,
        equipmentType: row.equipmentType,
        externalId: row.externalId,
        qrCode: row.qrCode,
        serialNumber: row.serialNumber,
        model: row.model,
        manufacturer: row.manufacturer,
        condition: row.condition,
        estimatedLifespanYears: row.estimatedLifespanYears,
        installationDate: row.installationDate,
        replacementCost: row.replacementCost,
        installationCost: row.installationCost,
        warrantyExpirationDate: row.warrantyExpirationDate,
      });
      working = [
        ...working,
        {
          id,
          name: row.name,
          floor_id: floorId,
          area_id: areaId,
          external_id: row.externalId,
          building_id: row.buildingId,
          building_name: row.buildingName,
        },
      ];
    }
  }

  const preview: Array<{
    key: string;
    label: string;
    detail: string;
    action: "create" | "update" | "skip" | "error";
  }> = [
    ...planned.map((item, index) => ({
      key: `equipment-${item.id}-${index}`,
      label: item.name,
      detail:
        item.action === "update" && item.previousName
          ? t(dict.admin.equipmentUploadPreviewChangeName, {
              from: item.previousName,
              to: item.name,
            })
          : [item.buildingName, item.areaName].filter(Boolean).join(" · "),
      action: item.action as "create" | "update" | "skip",
    })),
    // Rows that failed to resolve (unknown building, missing floor/area, ...)
    // — will NOT be uploaded. Always shown to the user, never silently dropped.
    ...rowIssues.map((issue) => ({
      key: `equipment-error-${issue.rowNumber}`,
      label: rowNames.get(issue.rowNumber) || `#${issue.rowNumber}`,
      detail: rowError(issue.rowNumber, issue.message),
      action: "error" as const,
    })),
  ];

  if (options?.previewOnly) {
    return { preview, skipped: rowIssues.length };
  }

  if (planned.length === 0) {
    return {
      success: ctx.dict.admin.equipmentUploaded.replace("{count}", "0"),
      equipment: [],
      created: 0,
      updated: 0,
      skipped: rowIssues.length,
    };
  }

  const importedItems = planned.filter((item) => item.action !== "skip");
  if (importedItems.length === 0) {
    return {
      success: ctx.dict.admin.equipmentUploaded.replace("{count}", "0"),
      equipment: [],
      created: 0,
      updated: 0,
      skipped: rowIssues.length,
    };
  }
  const queries = importedItems.map((item) => {
    if (item.action === "update") {
      if (item.nameOnly) {
        return sql`
          UPDATE equipment
          SET name = ${item.name}
          WHERE id = ${item.id}
            AND COALESCE(
              equipment.building_id,
              (SELECT f.building_id FROM floors f WHERE f.id = equipment.floor_id),
              (SELECT a.building_id FROM areas a WHERE a.id = equipment.area_id)
            ) = ${item.buildingId}
          RETURNING id, name, floor_id, area_id, building_id, equipment_type, description, external_id, qr_code
        `;
      }
      return sql`
        UPDATE equipment
        SET
          name = ${item.name},
          floor_id = ${item.floorId},
          area_id = ${item.areaId},
          building_id = ${item.buildingId},
          description = ${item.description},
          equipment_type = ${item.equipmentType},
          external_id = ${item.externalId},
          qr_code = COALESCE(equipment.qr_code, ${item.qrCode}),
          serial_number = ${item.serialNumber},
          model = ${item.model},
          manufacturer = ${item.manufacturer},
          condition = ${item.condition},
          estimated_lifespan_years = ${item.estimatedLifespanYears},
          installation_date = ${item.installationDate},
          replacement_cost = ${item.replacementCost},
          installation_cost = ${item.installationCost},
          warranty_expiration_date = ${item.warrantyExpirationDate}
        WHERE id = ${item.id}
          AND COALESCE(
            equipment.building_id,
            (SELECT f.building_id FROM floors f WHERE f.id = equipment.floor_id),
            (SELECT a.building_id FROM areas a WHERE a.id = equipment.area_id)
          ) = ${item.buildingId}
        RETURNING id, name, floor_id, area_id, building_id, equipment_type, description, external_id, qr_code,
          serial_number, model, manufacturer, condition, estimated_lifespan_years,
          installation_date, replacement_cost, installation_cost, warranty_expiration_date
      `;
    }
    return sql`
      INSERT INTO equipment (
        id,
        name,
        floor_id,
        area_id,
        building_id,
        description,
        equipment_type,
        external_id,
        qr_code,
        serial_number,
        model,
        manufacturer,
        condition,
        estimated_lifespan_years,
        installation_date,
        replacement_cost,
        installation_cost,
        warranty_expiration_date
      )
      VALUES (
        ${item.id},
        ${item.name},
        ${item.floorId},
        ${item.areaId},
        ${item.buildingId},
        ${item.description},
        ${item.equipmentType},
        ${item.externalId},
        ${item.qrCode},
        ${item.serialNumber},
        ${item.model},
        ${item.manufacturer},
        ${item.condition},
        ${item.estimatedLifespanYears},
        ${item.installationDate},
        ${item.replacementCost},
        ${item.installationCost},
        ${item.warrantyExpirationDate}
      )
      RETURNING id, name, floor_id, area_id, building_id, equipment_type, description, external_id, qr_code,
        serial_number, model, manufacturer, condition, estimated_lifespan_years,
        installation_date, replacement_cost, installation_cost, warranty_expiration_date
    `;
  });

  let results;
  try {
    results = await sql.transaction(queries);
  } catch (error) {
    console.error("importEquipmentAction failed:", error);
    const dbError = error as { message?: string; detail?: string };
    const detail = dbError.detail || dbError.message;
    return {
      error: detail
        ? `${dict.admin.equipmentUploadFailed} (${detail})`
        : dict.admin.equipmentUploadFailed,
    };
  }
  const equipment = results.flat().map((row, index) => {
    const plan = planned[index];
    return {
      id: row.id as string,
      name: row.name as string,
      floor_id: (row.floor_id as string | null) ?? null,
      area_id: (row.area_id as string | null) ?? null,
      equipment_type: (row.equipment_type as string | null) ?? null,
      description: (row.description as string | null) ?? null,
      external_id: (row.external_id as string | null) ?? null,
      qr_code: (row.qr_code as string | null) ?? null,
      building_id:
        (row.building_id as string | null) ?? plan?.buildingId ?? undefined,
      building_name: plan?.buildingName,
      serial_number: (row.serial_number as string | null) ?? null,
      model: (row.model as string | null) ?? null,
      manufacturer: (row.manufacturer as string | null) ?? null,
      condition: (row.condition as string | null) ?? null,
      estimated_lifespan_years:
        (row.estimated_lifespan_years as number | null) ?? null,
      installation_date: (row.installation_date as string | null) ?? null,
      replacement_cost: (row.replacement_cost as number | null) ?? null,
      installation_cost: (row.installation_cost as number | null) ?? null,
      warranty_expiration_date:
        (row.warranty_expiration_date as string | null) ?? null,
    };
  });

  const created = importedItems.filter((item) => item.action === "create").length;
  const updated = importedItems.filter((item) => item.action === "update").length;

  revalidatePath("/buildings");
  return {
    success:
      updated > 0
        ? ctx.dict.admin.equipmentUploadedMixed
            .replace("{create}", String(created))
            .replace("{update}", String(updated))
        : ctx.dict.admin.equipmentUploaded.replace("{count}", String(created)),
    equipment,
    created,
    updated,
    skipped: rowIssues.length,
  };
}
