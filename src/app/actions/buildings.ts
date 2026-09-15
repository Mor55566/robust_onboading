"use server";

import { z } from "zod";
import { requireSuperAdmin, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { getDictionary } from "@/i18n/get-dictionary";

export type BuildingWithUploadCounts = {
  id: string;
  name: string;
  floorCount: number;
  areaCount: number;
  equipmentCount: number;
};

export async function getBuildingsForComplexAction(
  complexId: string,
): Promise<BuildingWithUploadCounts[]> {
  await requireSuperAdmin();
  const parsedComplexId = z.string().uuid().safeParse(complexId);
  if (!parsedComplexId.success) return [];

  const rows = await sql`
    SELECT
      b.id,
      b.name,
      (SELECT COUNT(*) FROM floors f WHERE f.building_id = b.id)::int AS floor_count,
      (SELECT COUNT(*) FROM areas a WHERE a.building_id = b.id)::int AS area_count,
      (SELECT COUNT(*) FROM equipment e WHERE e.building_id = b.id)::int AS equipment_count
    FROM buildings b
    WHERE b.complex_id = ${parsedComplexId.data}
    ORDER BY b.name ASC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    floorCount: row.floor_count as number,
    areaCount: row.area_count as number,
    equipmentCount: row.equipment_count as number,
  }));
}

export type CreateBuildingState = {
  error?: string;
  building?: { id: string; name: string };
};

const createBuildingSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  complexId: z.string().trim().uuid(),
});

export async function createBuildingAction(
  _prev: CreateBuildingState,
  formData: FormData,
): Promise<CreateBuildingState> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const parsed = createBuildingSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    complexId: formData.get("complex_id"),
  });
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    if (fieldErrors.complexId) return { error: dict.errors.invalidComplex };
    return { error: dict.errors.nameRequired };
  }

  const rows = await sql`
    INSERT INTO buildings (name, address, complex_id, sort_order)
    VALUES (
      ${parsed.data.name},
      ${parsed.data.address || null},
      ${parsed.data.complexId},
      COALESCE(
        (SELECT MAX(sort_order) + 1 FROM buildings WHERE complex_id = ${parsed.data.complexId}),
        0
      )
    )
    RETURNING id, name
  `;
  const row = rows[0];

  return {
    building: { id: row.id as string, name: row.name as string },
  };
}
