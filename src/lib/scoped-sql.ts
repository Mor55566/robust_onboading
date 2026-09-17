import {
  getSessionContext as resolveSessionContext,
  toUuidArrayLiteral,
} from "@/lib/session-context";

/**
 * Wraps a `neon()` connection so every query runs in a transaction whose
 * first statement sets app.user_id, app.user_role, app.user_complex_ids and
 * app.user_admin_complex_ids from the current request's session (resolved
 * once per request by src/lib/session-context.ts). This keeps RLS context
 * and the protected query on the same connection and transaction.
 *
 * Ported verbatim from with_robust_app's src/lib/scoped-sql.ts - same
 * session-context.ts shape, same four Neon projects, same RLS policies.
 * Shared by src/lib/db.ts (main DB, already wrapped before this file
 * existed), users-db.ts, resident-db.ts and agents-db.ts.
 *
 * Generic and unconstrained on purpose: `neon()`'s return type carries a set
 * of overloaded call signatures TypeScript uses to infer each query's exact
 * row shape, and constraining `Database` to a named type here collapses
 * that back down to `any[]`/`FullQueryResults` at every call site. Keeping
 * it as a bare type parameter (input type === output type) preserves it.
 */
export function withSessionScope<Database extends object>(
  database: Database,
): Database {
  type AnyDatabase = Database & {
    (...args: unknown[]): PromiseLike<unknown> & Record<PropertyKey, unknown>;
    transaction: (queries: unknown, options?: unknown) => Promise<unknown[]>;
  };
  const db = database as AnyDatabase;
  type Query = ReturnType<AnyDatabase>;

  const INNER_QUERY = Symbol("inner database query");
  type ScopedQuery = Query & { [INNER_QUERY]: Query };

  function userContextQuery(ctx: {
    userId: string;
    role: string;
    complexIds: string[];
    adminComplexIds: string[];
  }) {
    return db`
      SELECT
        set_config('app.user_id', ${ctx.userId}, true),
        set_config('app.user_role', ${ctx.role}, true),
        set_config('app.user_complex_ids', ${toUuidArrayLiteral(ctx.complexIds)}, true),
        set_config('app.user_admin_complex_ids', ${toUuidArrayLiteral(ctx.adminComplexIds)}, true)
    `;
  }

  function unwrapQuery(query: Query): Query {
    return (query as Partial<ScopedQuery>)[INNER_QUERY] ?? query;
  }

  function scopeQuery(query: Query): Query {
    return new Proxy(query as ScopedQuery, {
      get(target, property, receiver) {
        if (property === INNER_QUERY) return query;

        if (property === "then" || property === "catch" || property === "finally") {
          const execute = async () => {
            const ctx = await resolveSessionContext();
            if (!ctx) return query;

            const results = await db.transaction([
              userContextQuery(ctx),
              query,
            ]);
            return (results as unknown[])[1];
          };

          const execution = execute();
          return Reflect.get(execution, property).bind(execution);
        }

        return Reflect.get(target, property, receiver);
      },
    }) as Query;
  }

  return new Proxy(database, {
    apply(target, thisArg, argumentsList) {
      return scopeQuery(Reflect.apply(target as AnyDatabase, thisArg, argumentsList) as Query);
    },
    get(target, property, receiver) {
      if (property !== "transaction") {
        return Reflect.get(target, property, receiver);
      }

      return async (
        queriesOrFactory: Parameters<AnyDatabase["transaction"]>[0],
        options?: Parameters<AnyDatabase["transaction"]>[1],
      ) => {
        const queries = (typeof queriesOrFactory === "function"
          ? queriesOrFactory(db as never)
          : (queriesOrFactory as Query[]).map(unwrapQuery)) as unknown as Query[];
        const ctx = await resolveSessionContext();

        if (!ctx) return db.transaction(queries, options);

        const results = await db.transaction(
          [userContextQuery(ctx), ...queries],
          options,
        );
        return (results as unknown[]).slice(1);
      };
    },
  }) as Database;
}
