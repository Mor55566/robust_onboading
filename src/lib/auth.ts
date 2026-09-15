import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import * as Sentry from "@sentry/nextjs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { cache } from "react";
import { SESSION_COOKIE } from "@/lib/constants";
import { sql as appSql } from "@/lib/db";
import { getSessionContext, getSessionToken } from "@/lib/session-context";
import { usersSql as sql } from "@/lib/users-db";
import type { SessionUser, UserRole } from "@/lib/types";
import { isAdminRole } from "@/lib/types";
import { loginHref, safeQrReturnPath } from "@/lib/native-app";

export { isAdminRole };

const SESSION_DAYS = 30;
const SESSION_TOUCH_MS = 5 * 60 * 1000;

type DbUser = {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  complex_id: string | null;
  complex_name: string | null;
  password_hash: string | null;
};

function toSessionUser(user: DbUser): SessionUser {
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    resident_id: null,
    complex_id: user.complex_id,
    complex_name: user.complex_name,
    chain_name: null,
    chain_logo_url: null,
  };
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function createSession(userId: string) {
  const sessionToken = randomBytes(32).toString("hex");
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);

  await sql`
    INSERT INTO user_sessions (user_id, session_token, expires_at)
    VALUES (${userId}, ${sessionToken}, ${expiresAt.toISOString()})
  `;

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    await sql`DELETE FROM user_sessions WHERE session_token = ${token}`;
    cookieStore.delete(SESSION_COOKIE);
  }
}

export const getSession = cache(async (): Promise<SessionUser | null> => {
  const ctx = await getSessionContext();
  if (!ctx) {
    Sentry.setUser(null);
    return null;
  }

  const lastActive = new Date(ctx.lastActiveAt).getTime();
  if (Number.isNaN(lastActive) || Date.now() - lastActive >= SESSION_TOUCH_MS) {
    const token = await getSessionToken();
    if (token) {
      await sql`
        UPDATE user_sessions
        SET last_active_at = now()
        WHERE session_token = ${token}
      `;
    }
  }

  const complexRows = ctx.complexId
    ? await appSql`
        SELECT c.name, ch.name AS chain_name, ch.logo_url AS chain_logo_url
        FROM complexes c
        LEFT JOIN chains ch ON ch.id = c.chain_id
        WHERE c.id = ${ctx.complexId}
        LIMIT 1
      `
    : [];
  const user = {
    id: ctx.userId,
    email: ctx.email,
    full_name: ctx.fullName,
    role: ctx.role as UserRole,
    resident_id: null,
    complex_id: ctx.complexId,
    complex_name: (complexRows[0]?.name as string | undefined) ?? null,
    chain_name: (complexRows[0]?.chain_name as string | undefined) ?? null,
    chain_logo_url:
      (complexRows[0]?.chain_logo_url as string | undefined) ?? null,
  };

  Sentry.setUser({ id: user.id, email: user.email, username: user.full_name });
  Sentry.setTag("complex_id", user.complex_id ?? "none");
  Sentry.setTag("complex_name", user.complex_name ?? "none");
  Sentry.setContext("complex", {
    id: user.complex_id,
    name: user.complex_name,
  });

  return user;
});

export async function requireUser() {
  const user = await getSession();
  if (!user) {
    const headerStore = await headers();
    const next = safeQrReturnPath(
      `${headerStore.get("x-robust-pathname") ?? ""}${headerStore.get("x-robust-search") ?? ""}`,
    );
    redirect(loginHref(next));
  }
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!isAdminRole(user.role)) {
    redirect("/");
  }
  return user;
}

export async function userCanManageComplexUsers(
  userId: string,
  complexId: string | null,
) {
  if (!complexId) return false;

  const rows = await sql`
    SELECT 1
    FROM user_complex_permissions
    WHERE user_id = ${userId}
      AND complex_id = ${complexId}
      AND role = 'admin'
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function requireSuperAdmin() {
  const user = await requireUser();
  if (user.role !== "super_admin") {
    redirect("/profile");
  }
  return user;
}

export async function authenticateUser(email: string, password: string) {
  const rows = await sql`
    SELECT
      u.id,
      u.email,
      u.full_name,
      u.role,
      CASE WHEN count(DISTINCT ucp.complex_id) = 1
        THEN min(ucp.complex_id::text)
        ELSE NULL
      END AS complex_id,
      NULL::text AS complex_name,
      u.password_hash
    FROM users u
    LEFT JOIN user_complex_permissions ucp ON ucp.user_id = u.id
    WHERE lower(u.email) = lower(${email})
    GROUP BY u.id
    LIMIT 1
  `;

  if (rows.length === 0) return null;

  const user = rows[0] as DbUser;
  if (!user.password_hash) return null;

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) return null;

  return toSessionUser(user);
}

const MAGIC_LINK_MINUTES = 15;
const MAGIC_LINK_RATE_LIMIT_MINUTES = 5;

// Overridable so local dev (including the e2e suite, which exercises this
// same per-user limit from two e2e/login.spec.ts tests sharing one counter,
// and which can run the suite itself several times in a row) can raise it
// without loosening the real anti-abuse limit in production - see
// MAGIC_LINK_RATE_LIMIT_REQUESTS in .env.development.local.
const MAGIC_LINK_RATE_LIMIT_REQUESTS = Number(
  process.env.MAGIC_LINK_RATE_LIMIT_REQUESTS ?? 3,
);

export type MagicLinkTokenResult =
  | { status: "created"; token: string; code: string }
  | { status: "rate_limited" }
  | { status: "user_not_found" };

function hashMagicLinkToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function hashMagicCode(code: string, salt: string) {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export async function createMagicLinkToken(
  email: string,
): Promise<MagicLinkTokenResult> {
  const users = await sql`
    SELECT id
    FROM users
    WHERE lower(email) = lower(${email})
    LIMIT 1
  `;
  const userId = users[0]?.id;
  if (typeof userId !== "string") return { status: "user_not_found" };

  const recent = await sql`
    SELECT count(*)::int AS count
    FROM user_magic_links
    WHERE user_id = ${userId}
      AND created_at > now() - (${MAGIC_LINK_RATE_LIMIT_MINUTES} * interval '1 minute')
  `;
  if (
    Number(recent[0]?.count ?? 0) >= MAGIC_LINK_RATE_LIMIT_REQUESTS
  ) {
    return { status: "rate_limited" };
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashMagicLinkToken(token);
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const codeSalt = randomBytes(16).toString("hex");
  const codeHash = hashMagicCode(code, codeSalt);
  await sql`
    INSERT INTO user_magic_links (user_id, token_hash, code_hash, code_salt, expires_at)
    VALUES (
      ${userId},
      ${tokenHash},
      ${codeHash},
      ${codeSalt},
      now() + (${MAGIC_LINK_MINUTES} * interval '1 minute')
    )
  `;
  return { status: "created", token, code };
}

export async function consumeMagicCode(email: string, code: string) {
  const rows = await sql`
    SELECT ml.id::text, ml.user_id::text, ml.code_hash, ml.code_salt
    FROM user_magic_links ml
    JOIN users u ON u.id = ml.user_id
    WHERE lower(u.email) = lower(${email})
      AND ml.used_at IS NULL
      AND ml.expires_at > now()
      AND ml.failed_attempts < 5
    ORDER BY ml.created_at DESC
    LIMIT 3
  `;
  const match = rows.find((row) => {
    if (typeof row.code_hash !== "string" || typeof row.code_salt !== "string") return false;
    const actual = Buffer.from(hashMagicCode(code, row.code_salt), "hex");
    const expected = Buffer.from(row.code_hash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!match) {
    const latestId = rows[0]?.id;
    if (typeof latestId === "string") await sql`UPDATE user_magic_links SET failed_attempts = failed_attempts + 1 WHERE id = ${latestId}`;
    return null;
  }
  const consumed = await sql`
    UPDATE user_magic_links SET used_at = now()
    WHERE id = ${match.id} AND used_at IS NULL AND expires_at > now()
    RETURNING user_id::text AS user_id
  `;
  return typeof consumed[0]?.user_id === "string" ? consumed[0].user_id : null;
}

export async function consumeMagicLinkToken(token: string) {
  const tokenHash = hashMagicLinkToken(token);
  const rows = await sql`
    UPDATE user_magic_links
    SET used_at = now()
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > now()
    RETURNING user_id::text AS user_id
  `;
  const userId = rows[0]?.user_id;
  return typeof userId === "string" ? userId : null;
}

export async function discardMagicLinkToken(token: string) {
  const tokenHash = hashMagicLinkToken(token);
  await sql`
    DELETE FROM user_magic_links
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
  `;
}
