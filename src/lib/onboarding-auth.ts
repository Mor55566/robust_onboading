import "server-only";

import { usersSql as sql } from "@/lib/users-db";

// This app is the super-admin-only onboarding tool: every place that would
// otherwise call createSession() (ported from with_robust_app) must check
// this first and refuse to create a session for anyone else.
export async function isSuperAdminUserId(userId: string) {
  const rows = await sql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`;
  return rows[0]?.role === "super_admin";
}
