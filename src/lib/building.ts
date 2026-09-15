import { sql } from "@/lib/db";
import { getSessionContext } from "@/lib/session-context";
import type { SessionUser } from "@/lib/types";
import type {
  BuildingOption,
  ComplexBuildingSummary,
} from "@/lib/building-shared";

export {
  ALL_BUILDINGS_ID,
  isAllBuildingsId,
  type BuildingOption,
  type ComplexBuildingSummary,
} from "@/lib/building-shared";

function mapBuildingWithCounts(row: Record<string, unknown>): ComplexBuildingSummary {
  return {
    id: row.id as string,
    name: row.name as string,
    address: row.address as string | null,
    complex_id: (row.complex_id as string | null) ?? null,
    sort_order: Number(row.sort_order ?? 0),
    floors_count: Number(row.floors_count ?? 0),
    locations_count: Number(row.locations_count ?? 0),
    equipment_count: Number(row.equipment_count ?? 0),
  };
}

export async function resolveBuildingId(
  user: SessionUser,
): Promise<string | null> {
  const ctx = await getSessionContext();
  const complexIds = ctx?.complexIds ?? [];
  if (complexIds.length > 0) {
    const permissionRows = await sql`
      SELECT id
      FROM buildings
      WHERE complex_id = ANY(${complexIds})
        AND is_hidden = false
      ORDER BY sort_order ASC, name ASC
      LIMIT 1
    `;
    if (permissionRows.length > 0) {
      return permissionRows[0].id as string;
    }
  }

  if (user.role === "super_admin") {
    const rows = await sql`
      SELECT id FROM buildings WHERE is_hidden = false ORDER BY sort_order ASC, name ASC LIMIT 1
    `;
    if (rows.length > 0) {
      return rows[0].id as string;
    }
  }

  return null;
}

export async function resolveSelectedBuildingId(
  user: SessionUser,
  requestedBuildingId?: string | null,
): Promise<string | null> {
  if (requestedBuildingId) {
    if (await userCanAccessBuilding(user, requestedBuildingId)) {
      return requestedBuildingId;
    }
  }
  return resolveBuildingId(user);
}

export async function getAccessibleBuildings(
  user: SessionUser,
): Promise<BuildingOption[]> {
  if (user.role === "super_admin") {
    const rows = await sql`
      SELECT id, name FROM buildings WHERE is_hidden = false ORDER BY sort_order ASC, name ASC
    `;
    return rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
    }));
  }

  const ctx = await getSessionContext();
  const complexIds = ctx?.complexIds ?? [];
  if (complexIds.length === 0) return [];

  const rows = await sql`
    SELECT id, name, sort_order
    FROM buildings
    WHERE complex_id = ANY(${complexIds})
      AND is_hidden = false
    ORDER BY sort_order ASC, name ASC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
  }));
}

export async function getAdminBuildingIds(user: SessionUser): Promise<string[]> {
  if (user.role === "super_admin") {
    const rows = await sql`SELECT id FROM buildings WHERE is_hidden = false`;
    return rows.map((row) => row.id as string);
  }

  const ctx = await getSessionContext();
  const adminComplexIds = ctx?.adminComplexIds ?? [];
  if (adminComplexIds.length === 0) return [];

  const rows = await sql`
    SELECT id FROM buildings WHERE complex_id = ANY(${adminComplexIds}) AND is_hidden = false
  `;
  return rows.map((row) => row.id as string);
}

export async function userCanAccessBuilding(
  user: SessionUser,
  buildingId: string,
): Promise<boolean> {
  if (user.role === "super_admin") {
    return true;
  }

  const rows = await sql`
    SELECT complex_id FROM buildings WHERE id = ${buildingId} LIMIT 1
  `;
  const complexId = rows[0]?.complex_id as string | null | undefined;
  if (!complexId) return false;

  const ctx = await getSessionContext();
  return (ctx?.complexIds ?? []).includes(complexId);
}

export async function getBuilding(buildingId: string) {
  const rows = await sql`
    SELECT id, name, address, complex_id, sort_order, created_at
    FROM buildings
    WHERE id = ${buildingId}
      AND is_hidden = false
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function resolveComplexId(
  buildingId: string,
): Promise<string | null> {
  const building = await getBuilding(buildingId);
  return (building?.complex_id as string | null) ?? null;
}

export async function listBuildingsWithCounts(options?: {
  complexId?: string | null;
}): Promise<ComplexBuildingSummary[]> {
  const complexId = options?.complexId ?? null;

  const rows = complexId
    ? await sql`
        SELECT
          b.id,
          b.name,
          b.address,
          b.complex_id,
          b.sort_order,
          COALESCE(fc.floors_count, 0) AS floors_count,
          COALESCE(lc.locations_count, 0) AS locations_count,
          COALESCE(ec.equipment_count, 0) AS equipment_count
        FROM buildings b
        LEFT JOIN (
          SELECT building_id, COUNT(*)::int AS floors_count
          FROM floors
          WHERE is_hidden = false
          GROUP BY building_id
        ) fc ON fc.building_id = b.id
        LEFT JOIN (
          SELECT building_id, COUNT(*)::int AS locations_count
          FROM areas
          WHERE building_id IS NOT NULL
            AND is_hidden = false
          GROUP BY building_id
        ) lc ON lc.building_id = b.id
        LEFT JOIN (
          SELECT COALESCE(e.building_id, f.building_id, a.building_id) AS building_id,
                 COUNT(*)::int AS equipment_count
          FROM equipment e
          LEFT JOIN floors f ON f.id = e.floor_id
          LEFT JOIN areas a ON a.id = e.area_id
          WHERE COALESCE(e.building_id, f.building_id, a.building_id) IS NOT NULL
            AND e.is_hidden = false
          GROUP BY COALESCE(e.building_id, f.building_id, a.building_id)
        ) ec ON ec.building_id = b.id
        WHERE b.complex_id = ${complexId}
          AND b.is_hidden = false
        ORDER BY b.sort_order ASC, b.name ASC
      `
    : await sql`
        SELECT
          b.id,
          b.name,
          b.address,
          b.complex_id,
          b.sort_order,
          COALESCE(fc.floors_count, 0) AS floors_count,
          COALESCE(lc.locations_count, 0) AS locations_count,
          COALESCE(ec.equipment_count, 0) AS equipment_count
        FROM buildings b
        LEFT JOIN (
          SELECT building_id, COUNT(*)::int AS floors_count
          FROM floors
          WHERE is_hidden = false
          GROUP BY building_id
        ) fc ON fc.building_id = b.id
        LEFT JOIN (
          SELECT building_id, COUNT(*)::int AS locations_count
          FROM areas
          WHERE building_id IS NOT NULL
            AND is_hidden = false
          GROUP BY building_id
        ) lc ON lc.building_id = b.id
        LEFT JOIN (
          SELECT COALESCE(e.building_id, f.building_id, a.building_id) AS building_id,
                 COUNT(*)::int AS equipment_count
          FROM equipment e
          LEFT JOIN floors f ON f.id = e.floor_id
          LEFT JOIN areas a ON a.id = e.area_id
          WHERE COALESCE(e.building_id, f.building_id, a.building_id) IS NOT NULL
            AND e.is_hidden = false
          GROUP BY COALESCE(e.building_id, f.building_id, a.building_id)
        ) ec ON ec.building_id = b.id
        WHERE b.is_hidden = false
        ORDER BY b.sort_order ASC, b.name ASC
      `;

  return rows.map(mapBuildingWithCounts);
}
