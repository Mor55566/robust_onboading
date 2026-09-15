import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { neon } from "@neondatabase/serverless";
import { SESSION_COOKIE } from "@/lib/constants";

function getUsersDatabaseUrl() {
  const url = process.env.USERS_DATABASE_URL;
  if (!url) throw new Error("USERS_DATABASE_URL is not set");
  return url;
}

const usersDatabase = neon(getUsersDatabaseUrl());

export type SessionContext = {
  userId: string;
  email: string;
  fullName: string;
  role: string;
  complexId: string | null;
  complexIds: string[];
  adminComplexIds: string[];
  lastActiveAt: string;
};

export async function getSessionToken(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch (error) {
    // Also runs in build scripts and tests, where there is no Next.js
    // request context and therefore no authenticated user to propagate.
    if (
      error instanceof Error &&
      /outside a request scope|request context/i.test(error.message)
    ) {
      return null;
    }
    throw error;
  }
}

export function toUuidArrayLiteral(ids: string[]): string {
  return `{${ids.join(",")}}`;
}

// Cached per request: every sql call and every getSession() call in the
// same request resolves this exactly once.
export const getSessionContext = cache(
  async (): Promise<SessionContext | null> => {
    const token = await getSessionToken();
    if (!token) return null;

    const rows = await usersDatabase`
      SELECT
        u.id::text AS user_id,
        u.email,
        u.full_name,
        u.role,
        CASE WHEN count(DISTINCT ucp.complex_id) = 1
          THEN min(ucp.complex_id::text)
          ELSE NULL
        END AS complex_id,
        COALESCE(array_agg(DISTINCT ucp.complex_id) FILTER (WHERE ucp.complex_id IS NOT NULL), '{}') AS complex_ids,
        COALESCE(array_agg(DISTINCT ucp.complex_id) FILTER (WHERE ucp.role = 'admin'), '{}') AS admin_complex_ids,
        s.last_active_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN user_complex_permissions ucp ON ucp.user_id = u.id
      WHERE s.session_token = ${token}
        AND s.expires_at > now()
      GROUP BY u.id, s.last_active_at
      LIMIT 1
    `;

    if (rows.length === 0) return null;
    const row = rows[0];

    return {
      userId: row.user_id as string,
      email: row.email as string,
      fullName: row.full_name as string,
      role: row.role as string,
      complexId: row.complex_id as string | null,
      complexIds: row.complex_ids as string[],
      adminComplexIds: row.admin_complex_ids as string[],
      lastActiveAt: row.last_active_at as string,
    };
  },
);
