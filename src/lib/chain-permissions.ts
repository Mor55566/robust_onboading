import "server-only";

import * as Sentry from "@sentry/nextjs";
import { usersSql } from "@/lib/users-db";

/**
 * Gives every user holding a permission for `chainId` access to a complex
 * just created in that chain - the same rows with_robust_app's
 * src/lib/chain-permissions.ts sync writes (see its
 * db/users_chain_permissions.sql). Best effort: a failure here leaves the
 * complex created, and the "Resync" button on with_robust_app's
 * /profile/chains fixes the drift.
 */
export async function grantChainUsersAccessToNewComplex(
  complexId: string,
  chainId: string,
): Promise<void> {
  try {
    await usersSql`
      WITH inserted AS (
        INSERT INTO user_complex_permissions (user_id, complex_id, role)
        SELECT user_id, ${complexId}::uuid, role
        FROM user_chain_permissions
        WHERE chain_id = ${chainId}::uuid
        ON CONFLICT (user_id, complex_id) DO NOTHING
        RETURNING user_id
      )
      INSERT INTO chain_complex_grants (user_id, complex_id, chain_id)
      SELECT user_id, ${complexId}::uuid, ${chainId}::uuid FROM inserted
    `;
  } catch (error) {
    // 42P01: db/users_chain_permissions.sql isn't applied yet, so nobody
    // holds a chain permission - nothing to grant.
    if ((error as { code?: unknown } | null)?.code === "42P01") return;
    console.error("grantChainUsersAccessToNewComplex failed:", error);
    Sentry.captureException(error);
  }
}
