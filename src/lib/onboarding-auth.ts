import "server-only";

import { authLookupSql } from "@/lib/session-context";

// This app is the super-admin-only onboarding tool: every place that would
// otherwise call createSession() (ported from with_robust_app) must check
// this first and refuse to create a session for anyone else. Runs before a
// session exists, so it's a pre-auth lookup.
export async function isSuperAdminUserId(userId: string) {
  const rows = await authLookupSql`SELECT role FROM users WHERE id = ${userId} LIMIT 1`;
  return rows[0]?.role === "super_admin";
}
