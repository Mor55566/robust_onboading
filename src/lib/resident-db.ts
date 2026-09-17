import "server-only";

import { neon } from "@neondatabase/serverless";
import { withSessionScope } from "@/lib/scoped-sql";

function getResidentDatabaseUrl() {
  const url = process.env.RESIDENT_DATABASE_URL;
  if (!url) throw new Error("RESIDENT_DATABASE_URL is not set");
  return url;
}

// Complex-scoped RLS (with_robust_app's db/resident_complex_scoped_rls.sql,
// same database) reads app.user_complex_ids/app.user_admin_complex_ids -
// this app is only ever used by a real super_admin session (gated by
// requireSuperAdmin()), which every policy there already bypasses on.
export const residentSql = withSessionScope(neon(getResidentDatabaseUrl()));

export type ResidentRecord = {
  id: string;
  complex_id: string;
  name: string;
  external_id: string | null;
  status: "active" | "inactive";
  billing_address: string | null;
  users: ResidentUserRecord[];
  locations: ResidentLocationRecord[];
};

export type ResidentUserRecord = {
  id: string;
  resident_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  notes: string | null;
  role: string | null;
  status: "active" | "inactive";
};

export type ResidentLocationRecord = {
  id: string;
  resident_id: string;
  purpose: "occupancy" | "request_access";
  location_type: "complex" | "building" | "floor" | "area";
  location_id: string;
  include_descendants: boolean;
};

export type ResidentOption = {
  id: string;
  display_name: string;
};

export type ResidentImportRef = {
  id: string;
  complex_id: string;
  display_name: string;
};

function mapResidentOption(row: Record<string, unknown>): ResidentOption {
  return {
    id: row.id as string,
    display_name: row.name as string,
  };
}

export async function listResidentOptionsForComplex(
  complexId: string,
): Promise<ResidentOption[]> {
  const rows = await residentSql`
    SELECT id, name
    FROM residents
    WHERE complex_id = ${complexId}
      AND deleted_at IS NULL
    ORDER BY name ASC
  `;
  return rows.map(mapResidentOption);
}

export async function listResidentOptionsForComplexes(
  complexIds: string[],
): Promise<ResidentOption[]> {
  if (complexIds.length === 0) return [];
  const rows = await residentSql`
    SELECT id, name
    FROM residents
    WHERE complex_id = ANY(${complexIds})
      AND deleted_at IS NULL
    ORDER BY name ASC
  `;
  return rows.map(mapResidentOption);
}

export async function listResidentsForImport(): Promise<ResidentImportRef[]> {
  const rows = await residentSql`
    SELECT id, complex_id, name
    FROM residents
    WHERE deleted_at IS NULL
    ORDER BY name ASC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    complex_id: row.complex_id as string,
    display_name: row.name as string,
  }));
}

export async function residentExistsInComplex(
  residentId: string,
  complexId: string,
): Promise<boolean> {
  const rows = await residentSql`
    SELECT 1
    FROM residents
    WHERE id = ${residentId}
      AND complex_id = ${complexId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function getResidentDisplayNamesByIds(
  residentIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(residentIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await residentSql`
    SELECT id, name
    FROM residents
    WHERE id = ANY(${ids})
      AND deleted_at IS NULL
  `;
  return new Map(
    rows.map((row) => [row.id as string, row.name as string]),
  );
}

export async function getResidentDisplayNamesByUserIds(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await residentSql`
    SELECT ru.id AS user_id, r.name AS resident_name
    FROM resident_users ru
    INNER JOIN residents r ON r.id = ru.resident_id
    WHERE ru.id = ANY(${ids})
      AND ru.deleted_at IS NULL
      AND r.deleted_at IS NULL
  `;
  return new Map(
    rows.map((row) => [row.user_id as string, row.resident_name as string]),
  );
}

export async function listResidentsForComplex(
  complexId: string,
): Promise<ResidentRecord[]> {
  const [residentRows, userRows, locationRows] = await Promise.all([
    residentSql`
      SELECT id, complex_id, name, external_id, status, billing_address
      FROM residents
      WHERE complex_id = ${complexId}
        AND deleted_at IS NULL
      ORDER BY name ASC
    `,
    residentSql`
      SELECT ru.id, ru.resident_id, ru.name, ru.phone, ru.email, ru.notes, ru.role, ru.status
      FROM resident_users ru
      INNER JOIN residents r ON r.id = ru.resident_id
      WHERE r.complex_id = ${complexId}
        AND r.deleted_at IS NULL
        AND ru.deleted_at IS NULL
      ORDER BY ru.name ASC
    `,
    residentSql`
      SELECT rl.id, rl.resident_id, rl.purpose, rl.location_type,
             rl.location_id, rl.include_descendants
      FROM resident_locations rl
      INNER JOIN residents r ON r.id = rl.resident_id
      WHERE r.complex_id = ${complexId}
        AND r.deleted_at IS NULL
      ORDER BY rl.purpose ASC, rl.created_at ASC
    `,
  ]);

  const usersByResident = new Map<string, ResidentUserRecord[]>();
  for (const row of userRows) {
    const item = row as ResidentUserRecord;
    const items = usersByResident.get(item.resident_id) ?? [];
    items.push(item);
    usersByResident.set(item.resident_id, items);
  }

  const locationsByResident = new Map<string, ResidentLocationRecord[]>();
  for (const row of locationRows) {
    const item = row as ResidentLocationRecord;
    const items = locationsByResident.get(item.resident_id) ?? [];
    items.push(item);
    locationsByResident.set(item.resident_id, items);
  }

  return residentRows.map((row) => {
    const resident = row as Omit<ResidentRecord, "users" | "locations">;
    return {
      ...resident,
      users: usersByResident.get(resident.id) ?? [],
      locations: locationsByResident.get(resident.id) ?? [],
    };
  });
}
