import "server-only";

import { createHash } from "node:crypto";

import { sql } from "@/lib/db";
import type { EquipmentType } from "@/lib/equipment-types";

function toEquipmentType(row: Record<string, unknown>): EquipmentType {
  return {
    id: row.id as string,
    en: row.en as string,
    he: row.he as string,
    ru: row.ru as string,
  };
}

/**
 * Equipment types are per complex (db/equipment_types_per_complex.sql): each
 * complex keeps its own copy of the list, seeded from the defaults
 * (complex_id IS NULL). With no complex, returns the types of every complex
 * the user can see (RLS), one per id.
 */
export async function getEquipmentTypes(
  complexId: string | null,
): Promise<EquipmentType[]> {
  const rows = complexId
    ? await sql`
        SELECT id, en, he, ru
        FROM equipment_types
        WHERE complex_id = ${complexId} AND is_hidden = false
        ORDER BY en ASC
      `
    : await sql`
        SELECT * FROM (
          SELECT DISTINCT ON (id) id, en, he, ru
          FROM equipment_types
          WHERE complex_id IS NOT NULL AND is_hidden = false
          ORDER BY id, complex_id
        ) types
        ORDER BY en ASC
      `;
  return rows.map(toEquipmentType);
}

/** The equipment types of a building's complex. */
export async function getEquipmentTypesForBuilding(
  buildingId: string,
): Promise<EquipmentType[]> {
  const rows = await sql`
    SELECT et.id, et.en, et.he, et.ru
    FROM equipment_types et
    JOIN buildings b ON b.complex_id = et.complex_id
    WHERE b.id = ${buildingId} AND et.is_hidden = false
    ORDER BY et.en ASC
  `;
  return rows.map(toEquipmentType);
}

function slugifyEquipmentTypeId(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  // Non-Latin labels (e.g. Hebrew) slugify to nothing: derive a stable id from
  // the label so each new type doesn't fight over "type", "type_2", ...
  return base || `type_${createHash("sha1").update(value.trim()).digest("hex").slice(0, 8)}`;
}

export async function createEquipmentType(input: {
  complexId: string;
  en: string;
  he: string;
  ru: string;
}): Promise<EquipmentType> {
  const baseId = slugifyEquipmentTypeId(input.en);
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    const id = attempt === 0 ? baseId : `${baseId}_${attempt + 1}`;
    const rows = await sql`
      INSERT INTO equipment_types (complex_id, id, en, he, ru)
      VALUES (${input.complexId}, ${id}, ${input.en}, ${input.he}, ${input.ru})
      ON CONFLICT (complex_id, id) DO NOTHING
      RETURNING id, en, he, ru
    `;
    if (rows.length > 0) return toEquipmentType(rows[0]);
  }
  throw new Error("Could not generate a unique equipment type id");
}

export async function updateEquipmentType(input: {
  complexId: string;
  id: string;
  en: string;
  he: string;
  ru: string;
}): Promise<EquipmentType | null> {
  const rows = await sql`
    UPDATE equipment_types
    SET en = ${input.en}, he = ${input.he}, ru = ${input.ru}
    WHERE complex_id = ${input.complexId} AND id = ${input.id}
    RETURNING id, en, he, ru
  `;
  return rows.length > 0 ? toEquipmentType(rows[0]) : null;
}

export async function deleteEquipmentType(
  complexId: string,
  id: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE equipment_types
    SET is_hidden = true
    WHERE complex_id = ${complexId} AND id = ${id} AND is_hidden = false
    RETURNING id
  `;
  return rows.length > 0;
}
