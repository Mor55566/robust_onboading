"use server";

// New for robust_onboading — read-only support for src/lib/complex-guard.ts.
// Feeds the client-side cross-complex safety check with the system-wide
// name directories it needs (buildings, and mission-template titles), since
// several ported import actions resolve those names without any complex
// scoping (see src/lib/complex-guard.ts for why).

import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export type ComplexGuardDirectory = {
  buildings: { name: string; complexId: string | null }[];
  missionTemplateTitles: { name: string; complexId: string | null }[];
};

export async function getComplexGuardDirectoryAction(): Promise<ComplexGuardDirectory> {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    return { buildings: [], missionTemplateTitles: [] };
  }

  const [buildingRows, templateRows] = await Promise.all([
    sql`SELECT name, complex_id FROM buildings`,
    sql`
      SELECT t.title, b.complex_id
      FROM tasks t
      LEFT JOIN buildings b ON b.id = t.building_id
      WHERE t.type = 'template-mission'
    `,
  ]);

  return {
    buildings: buildingRows.map((row) => ({
      name: row.name as string,
      complexId: (row.complex_id as string | null) ?? null,
    })),
    missionTemplateTitles: templateRows.map((row) => ({
      name: row.title as string,
      complexId: (row.complex_id as string | null) ?? null,
    })),
  };
}
