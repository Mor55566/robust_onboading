import { sql } from "@/lib/db";

// Task categories every new complex starts with (see createComplexAction in
// src/app/actions/complexes.ts).
export const DEFAULT_TASK_CATEGORIES = [
  "מיזוג אוויר",
  "חשמל",
  "אינסטלציה",
  "מעליות",
  "בטיחות וכיבוי אש",
  "ניקיון",
  "אבטחה ובקרת כניסה",
  "תחזוקת מבנה",
  "חניונים",
  "גינון ושטחי חוץ",
  "מערכות מים ומשאבות",
  "מערכות תקשורת",
  "הדברה",
  "אחר",
] as const;

export async function seedDefaultCategoriesForComplex(complexId: string): Promise<number> {
  const ids = DEFAULT_TASK_CATEGORIES.map(() => crypto.randomUUID());
  const names = [...DEFAULT_TASK_CATEGORIES];
  const rows = await sql`
    INSERT INTO task_categories (id, name, complex_id)
    SELECT id, name, ${complexId}
    FROM unnest(${ids}::uuid[], ${names}::text[]) AS t(id, name)
    WHERE NOT EXISTS (
      SELECT 1 FROM task_categories
      WHERE complex_id = ${complexId} AND name = t.name
    )
    RETURNING id
  `;
  return rows.length;
}
