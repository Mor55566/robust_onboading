"use server";

// New for robust_onboading — with_robust_app has no complex-creation action
// at all (only updateComplexAction, which edits an existing row; see
// src/app/actions/admin.ts). Modeled on the closest existing pattern,
// createChainAction in with_robust_app's src/app/actions/chains.ts (same
// auth/validation shape), plus src/lib/agents-db.ts's new
// seedDefaultAgentsForComplex for the "copy default agents" step.

import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { seedDefaultAgentsForComplex } from "@/lib/agents-db";
import { getDictionary } from "@/i18n/get-dictionary";

export type CreateComplexState = {
  error?: string;
  complex?: { id: string; name: string };
  seededAgents?: number;
};

const createComplexSchema = z.object({
  name: z.string().trim().min(1),
  address: z.string().trim().optional(),
  squareMeters: z.string().trim().optional(),
  chainId: z.string().trim().optional(),
});

export async function createComplexAction(
  _prev: CreateComplexState,
  formData: FormData,
): Promise<CreateComplexState> {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  const parsed = createComplexSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address") ?? undefined,
    squareMeters: formData.get("square_meters") ?? undefined,
    chainId: formData.get("chain_id") ?? undefined,
  });
  if (!parsed.success) {
    return { error: dict.errors.nameRequired };
  }

  let squareMeters: number | null = null;
  if (parsed.data.squareMeters) {
    const value = Number(parsed.data.squareMeters);
    if (!Number.isFinite(value) || value < 0) {
      return { error: dict.errors.invalidInput };
    }
    squareMeters = value;
  }

  const chainId = parsed.data.chainId || null;
  if (chainId) {
    const parsedChainId = z.string().uuid().safeParse(chainId);
    if (!parsedChainId.success) {
      return { error: dict.errors.invalidInput };
    }
  }

  const rows = await sql`
    INSERT INTO complexes (name, address, square_meters, chain_id)
    VALUES (
      ${parsed.data.name},
      ${parsed.data.address || null},
      ${squareMeters},
      ${chainId}
    )
    RETURNING id, name
  `;
  const row = rows[0];
  const complexId = row.id as string;
  const complexName = row.name as string;

  let seededAgents = 0;
  try {
    seededAgents = await seedDefaultAgentsForComplex(complexId, chainId, user.id);
  } catch (error) {
    console.error("seedDefaultAgentsForComplex failed:", error);
  }

  return {
    complex: { id: complexId, name: complexName },
    seededAgents,
  };
}
