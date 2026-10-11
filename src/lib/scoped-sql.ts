import { withPrefixQuery } from "@/lib/prefixed-sql";
import {
  getSessionContext as resolveSessionContext,
  toUuidArrayLiteral,
} from "@/lib/session-context";

/**
 * Wraps a `neon()` connection so every query runs in a transaction whose
 * first statement sets app.user_id, app.user_role, app.user_complex_ids and
 * app.user_admin_complex_ids from the current request's session (resolved
 * once per request by src/lib/session-context.ts). This keeps RLS context
 * and the protected query on the same connection and transaction. Without a
 * session the query runs as is - see src/lib/prefixed-sql.ts.
 *
 * Ported from with_robust_app's src/lib/scoped-sql.ts - same
 * session-context.ts shape, same four Neon projects, same RLS policies.
 * Shared by src/lib/db.ts (main DB), users-db.ts, resident-db.ts and
 * agents-db.ts.
 */
export function withSessionScope<Database extends object>(
  database: Database,
): Database {
  return withPrefixQuery(database, async (db) => {
    const ctx = await resolveSessionContext();
    if (!ctx) return null;
    return {
      query: db`
        SELECT
          set_config('app.user_id', ${ctx.userId}, true),
          set_config('app.user_role', ${ctx.role}, true),
          set_config('app.user_complex_ids', ${toUuidArrayLiteral(ctx.complexIds)}, true),
          set_config('app.user_admin_complex_ids', ${toUuidArrayLiteral(ctx.adminComplexIds)}, true)
      `,
    };
  });
}
