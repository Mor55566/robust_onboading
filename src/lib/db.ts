import { neon } from "@neondatabase/serverless";
import {
  getSessionContext as resolveSessionContext,
  toUuidArrayLiteral,
} from "@/lib/session-context";

function getDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set");
  }
  return url;
}

const database = neon(getDatabaseUrl());

type Database = typeof database;
type Query = ReturnType<Database>;

const INNER_QUERY = Symbol("inner database query");

type ScopedQuery = Query & { [INNER_QUERY]: Query };

function userContextQuery(ctx: {
  userId: string;
  role: string;
  complexIds: string[];
  adminComplexIds: string[];
}) {
  return database`
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

          const results = await database.transaction([
            userContextQuery(ctx),
            query,
          ]);
          return results[1];
        };

        const execution = execute();
        return Reflect.get(execution, property).bind(execution);
      }

      return Reflect.get(target, property, receiver);
    },
  }) as Query;
}

const scopedDatabase = new Proxy(database, {
  apply(target, thisArg, argumentsList) {
    return scopeQuery(Reflect.apply(target, thisArg, argumentsList));
  },
  get(target, property, receiver) {
    if (property !== "transaction") {
      return Reflect.get(target, property, receiver);
    }

    return async (
      queriesOrFactory: Parameters<Database["transaction"]>[0],
      options?: Parameters<Database["transaction"]>[1],
    ) => {
      const queries = (typeof queriesOrFactory === "function"
        ? queriesOrFactory(database as never)
        : queriesOrFactory.map(unwrapQuery)) as unknown as Query[];
      const ctx = await resolveSessionContext();

      if (!ctx) return database.transaction(queries, options as never);

      const results = await database.transaction(
        [userContextQuery(ctx), ...queries],
        options as never,
      );
      return results.slice(1);
    };
  },
}) as Database;

/**
 * All authenticated queries run in a transaction whose first statement sets
 * app.user_id, app.user_role, app.user_complex_ids and
 * app.user_admin_complex_ids from the server-side session (resolved once per
 * request by src/lib/session-context.ts, shared with src/lib/auth.ts's
 * getSession()). This keeps RLS context and the protected query on the same
 * Neon connection and transaction. Only app.user_id is read by any policy
 * today — the other three are populated in advance of a future RLS
 * migration to them.
 */
export const sql = scopedDatabase;
