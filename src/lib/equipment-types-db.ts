import "server-only";

import { sql } from "@/lib/db";
import type { EquipmentType } from "@/lib/equipment-types";

export async function getEquipmentTypes(): Promise<EquipmentType[]> {
  const rows = await sql`
    SELECT id, en, he, ru
    FROM equipment_types
    ORDER BY en ASC
  `;
  return rows.map((row) => ({
    id: row.id as string,
    en: row.en as string,
    he: row.he as string,
    ru: row.ru as string,
  }));
}

function slugifyEquipmentTypeId(value: string): string {
  const base = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "type";
}

export async function createEquipmentType(input: {
  en: string;
  he: string;
  ru: string;
}): Promise<EquipmentType> {
  const baseId = slugifyEquipmentTypeId(input.en);
  for (let attempt = 0; attempt <= 20; attempt += 1) {
    const id = attempt === 0 ? baseId : `${baseId}_${attempt + 1}`;
    const rows = await sql`
      INSERT INTO equipment_types (id, en, he, ru)
      VALUES (${id}, ${input.en}, ${input.he}, ${input.ru})
      ON CONFLICT (id) DO NOTHING
      RETURNING id, en, he, ru
    `;
    if (rows.length > 0) {
      const row = rows[0];
      return {
        id: row.id as string,
        en: row.en as string,
        he: row.he as string,
        ru: row.ru as string,
      };
    }
  }
  throw new Error("Could not generate a unique equipment type id");
}

export async function updateEquipmentType(input: {
  id: string;
  en: string;
  he: string;
  ru: string;
}): Promise<EquipmentType | null> {
  const rows = await sql`
    UPDATE equipment_types
    SET en = ${input.en}, he = ${input.he}, ru = ${input.ru}
    WHERE id = ${input.id}
    RETURNING id, en, he, ru
  `;
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    en: row.en as string,
    he: row.he as string,
    ru: row.ru as string,
  };
}

export async function deleteEquipmentType(id: string): Promise<boolean> {
  const rows = await sql`
    DELETE FROM equipment_types
    WHERE id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}
