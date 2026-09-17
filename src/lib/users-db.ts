import "server-only";

import { neon } from "@neondatabase/serverless";
import { withSessionScope } from "@/lib/scoped-sql";

function getUsersDatabaseUrl() {
  const url = process.env.USERS_DATABASE_URL;
  if (!url) throw new Error("USERS_DATABASE_URL is not set");
  return url;
}

// Complex-scoped RLS (with_robust_app's db/users_complex_scoped_rls.sql,
// same database) - this app is only ever used by a real super_admin
// session (gated by requireSuperAdmin()), which every policy there already
// bypasses on. NB: this app's own session-context.ts uses its own
// unwrapped connection for the bootstrap query, same reasoning as
// with_robust_app's.
export const usersSql = withSessionScope(neon(getUsersDatabaseUrl()));

export type UserRole =
  | "user"
  | "resident_admin"
  | "building_admin"
  | "super_admin";

export type UserRecord = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  phone_number: number | null;
  role_description: number | null;
  external_id: string | null;
  preferred_language: string;
};

export type ComplexUserRecord = UserRecord & {
  complex_role: "user" | "admin";
};

export async function getUsersByIds(
  userIds: string[],
): Promise<Map<string, UserRecord>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await usersSql`
    SELECT id, email, full_name, role, phone_number, role_description,
           external_id, preferred_language
    FROM users
    WHERE id = ANY(${ids})
  `;
  return new Map(rows.map((row) => [row.id as string, row as UserRecord]));
}

export async function getUserDisplayNamesByIds(
  userIds: string[],
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await usersSql`
    SELECT id, full_name
    FROM users
    WHERE id = ANY(${ids})
  `;
  return new Map(
    rows.map((row) => [row.id as string, row.full_name as string]),
  );
}

export async function getUsersForComplex(
  complexId: string,
): Promise<ComplexUserRecord[]> {
  const rows = await usersSql`
    SELECT u.id, u.email, u.full_name, u.role, u.phone_number,
           u.role_description, u.external_id, u.preferred_language,
           ucp.role AS complex_role
    FROM users u
    JOIN user_complex_permissions ucp ON ucp.user_id = u.id
    WHERE ucp.complex_id = ${complexId}
    ORDER BY u.full_name ASC
  `;
  return rows as ComplexUserRecord[];
}

export async function getUsersForComplexes(
  complexIds: string[],
): Promise<ComplexUserRecord[]> {
  const ids = [...new Set(complexIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const rows = await usersSql`
    SELECT u.id, u.email, u.full_name, u.role, u.phone_number,
           u.role_description, u.external_id, u.preferred_language,
           ucp.role AS complex_role
    FROM users u
    JOIN user_complex_permissions ucp ON ucp.user_id = u.id
    WHERE ucp.complex_id = ANY(${ids})
    ORDER BY u.full_name ASC
  `;
  return rows as ComplexUserRecord[];
}

export async function userHasComplexPermission(
  userId: string,
  complexId: string,
  role?: "admin",
): Promise<boolean> {
  const rows = role
    ? await usersSql`
        SELECT 1 FROM user_complex_permissions
        WHERE user_id = ${userId} AND complex_id = ${complexId} AND role = ${role}
        LIMIT 1
      `
    : await usersSql`
        SELECT 1 FROM user_complex_permissions
        WHERE user_id = ${userId} AND complex_id = ${complexId}
        LIMIT 1
      `;
  return rows.length > 0;
}
