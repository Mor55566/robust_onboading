"use server";

// New for robust_onboading — read-only support for src/lib/complex-guard.ts.
// Feeds the client-side cross-complex safety check with the system-wide
// building-name directory it needs — see
// src/lib/complex-guard.ts.

import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";

export type ComplexGuardDirectory = {
  buildings: { name: string; complexId: string | null }[];
};

export async function getComplexGuardDirectoryAction(): Promise<ComplexGuardDirectory> {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    return { buildings: [] };
  }

  const buildingRows = await sql`SELECT name, complex_id FROM buildings`;

  return {
    buildings: buildingRows.map((row) => ({
      name: row.name as string,
      complexId: (row.complex_id as string | null) ?? null,
    })),
  };
}
