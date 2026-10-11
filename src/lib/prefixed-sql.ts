/**
 * Wraps a `neon()` connection so every query (and every `.transaction()`)
 * runs in a transaction whose first statement is `prefix(db).query` -
 * typically set_config() calls RLS policies read - keeping that setting and
 * the protected query on the same Neon connection and transaction. `prefix`
 * returning null runs the query unwrapped.
 *
 * Shared by src/lib/scoped-sql.ts (the request's staff session) and
 * src/lib/session-context.ts (pre-auth lookups). No imports on purpose:
 * both of those import it, and scoped-sql.ts also imports session-context.ts.
 *
 * Generic and unconstrained on purpose: `neon()`'s return type carries a set
 * of overloaded call signatures TypeScript uses to infer each query's exact
 * row shape, and constraining `Database` to a named type here collapses
 * that back down to `any[]`/`FullQueryResults` at every call site. Keeping
 * it as a bare type parameter (input type === output type) preserves it.
 */
export function withPrefixQuery<Database extends object>(
  database: Database,
  prefix: (
    db: (strings: TemplateStringsArray, ...values: unknown[]) => unknown,
  ) => Promise<{ query: unknown } | null> | { query: unknown } | null,
): Database {
  type AnyDatabase = Database & {
    (...args: unknown[]): PromiseLike<unknown> & Record<PropertyKey, unknown>;
    transaction: (queries: unknown, options?: unknown) => Promise<unknown[]>;
  };
  const db = database as AnyDatabase;
  type Query = ReturnType<AnyDatabase>;

  const INNER_QUERY = Symbol("inner database query");
  type ScopedQuery = Query & { [INNER_QUERY]: Query };

  // Kept wrapped in { query } all the way to db.transaction(): a neon query
  // is a thenable, so returning it bare from an async function would run it
  // on its own instead of inside the transaction.
  async function prefixQuery() {
    return (await prefix(db as never)) as { query: Query } | null;
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
            const first = await prefixQuery();
            if (!first) return query;

            const results = await db.transaction([first.query, query]);
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
        const first = await prefixQuery();

        if (!first) return db.transaction(queries, options);

        const results = await db.transaction([first.query, ...queries], options);
        return (results as unknown[]).slice(1);
      };
    },
  }) as Database;
}
