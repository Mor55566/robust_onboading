"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "crypto";
import { z } from "zod";
import { hashPassword, requireUser } from "@/lib/auth";
import { sql } from "@/lib/db";
import { usersSql } from "@/lib/users-db";
import { getDictionary } from "@/i18n/get-dictionary";

export type UserAccessAssignment = { complexId: string; role: "user" | "admin" };

export type UserAccessRow = {
  id: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  isSuperAdmin: boolean;
  assignments: UserAccessAssignment[];
};

const MAX_LIST = 200;

async function requireSuperAdminAction() {
  const [user, dict] = await Promise.all([requireUser(), getDictionary()]);
  if (user.role !== "super_admin") return { dict, error: dict.errors.unauthorized } as const;
  return { dict, user } as const;
}

/**
 * Lists users with their complex permissions. `multiOnly` keeps just the users
 * that have access to more than one complex; `search` matches name or email.
 */
export async function listUserAccessAction(params: {
  multiOnly: boolean;
  search: string;
}): Promise<{ error?: string; users?: UserAccessRow[]; truncated?: boolean }> {
  const auth = await requireSuperAdminAction();
  if ("error" in auth) return { error: auth.error };

  const parsed = z
    .object({ multiOnly: z.boolean(), search: z.string().trim().max(200) })
    .safeParse(params);
  if (!parsed.success) return { error: auth.dict.errors.invalidInput };
  const pattern = `%${parsed.data.search.replace(/[\\%_]/g, "\\$&")}%`;
  const minComplexes = parsed.data.multiOnly ? 2 : 1;

  const rows = await usersSql`
    WITH matched AS (
      SELECT u.id, u.full_name, u.email, u.phone_number, u.role
      FROM users u
      WHERE (u.full_name ILIKE ${pattern} OR u.email ILIKE ${pattern})
        AND (
          SELECT count(*) FROM user_complex_permissions p WHERE p.user_id = u.id
        ) >= ${minComplexes}
      ORDER BY u.full_name ASC
      LIMIT ${MAX_LIST + 1}
    )
    SELECT m.id, m.full_name, m.email, m.phone_number, m.role,
           p.complex_id, p.role AS complex_role
    FROM matched m
    LEFT JOIN user_complex_permissions p ON p.user_id = m.id
    ORDER BY m.full_name ASC, m.id
  `;

  const byId = new Map<string, UserAccessRow>();
  for (const row of rows) {
    const id = row.id as string;
    let entry = byId.get(id);
    if (!entry) {
      entry = {
        id,
        fullName: row.full_name as string,
        email: row.email as string,
        phoneNumber: row.phone_number == null ? "" : String(row.phone_number),
        isSuperAdmin: row.role === "super_admin",
        assignments: [],
      };
      byId.set(id, entry);
    }
    if (row.complex_id) {
      entry.assignments.push({
        complexId: row.complex_id as string,
        role: row.complex_role === "admin" ? "admin" : "user",
      });
    }
  }
  const users = [...byId.values()];
  return { users: users.slice(0, MAX_LIST), truncated: users.length > MAX_LIST };
}

const assignmentSchema = z
  .array(
    z.object({
      complexId: z.string().uuid(),
      role: z.enum(["user", "admin"]),
    }),
  )
  .min(1)
  .max(1_000)
  .refine((list) => new Set(list.map((item) => item.complexId)).size === list.length);

const baseUserSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.email(),
  phoneNumber: z.string().trim(),
  assignments: assignmentSchema,
});

function parsePhone(raw: string): { ok: true; value: number | null } | { ok: false } {
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (!cleaned) return { ok: true, value: null };
  if (!/^\d+$/.test(cleaned) || !Number.isSafeInteger(Number(cleaned))) return { ok: false };
  return { ok: true, value: Number(cleaned) };
}

async function allComplexesExist(ids: string[]) {
  const rows = await sql`SELECT id FROM complexes WHERE id = ANY(${ids}::uuid[])`;
  return rows.length === ids.length;
}

export async function createUserWithComplexesAction(input: {
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
  assignments: UserAccessAssignment[];
}): Promise<{ error?: string; userId?: string }> {
  const auth = await requireSuperAdminAction();
  if ("error" in auth) return { error: auth.error };
  const { dict } = auth;

  const parsed = baseUserSchema
    .extend({ password: z.union([z.literal(""), z.string().min(8)]) })
    .safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.assignments) return { error: dict.userAccess.complexesRequired };
    if (fields.email) return { error: dict.errors.invalidEmail };
    if (fields.password) return { error: dict.errors.passwordMin };
    return { error: dict.errors.nameRequired };
  }
  const phone = parsePhone(parsed.data.phoneNumber);
  if (!phone.ok) return { error: dict.errors.invalidInput };

  const complexIds = parsed.data.assignments.map((item) => item.complexId);
  if (!(await allComplexesExist(complexIds))) return { error: dict.admin.complexNotFound };

  const email = parsed.data.email.toLocaleLowerCase();
  const existing = await usersSql`SELECT id FROM users WHERE lower(email) = ${email} LIMIT 1`;
  if (existing.length > 0) return { error: dict.superAdmin.usersEmailTaken };

  const userId = randomUUID();
  const passwordHash = parsed.data.password ? await hashPassword(parsed.data.password) : null;
  try {
    await usersSql.transaction([
      usersSql`
        INSERT INTO users (id, email, full_name, role, phone_number, password_hash)
        VALUES (${userId}, ${email}, ${parsed.data.fullName}, 'user', ${phone.value}, ${passwordHash})
      `,
      ...parsed.data.assignments.map(
        (item) => usersSql`
          INSERT INTO user_complex_permissions (user_id, complex_id, role)
          VALUES (${userId}, ${item.complexId}, ${item.role})
        `,
      ),
    ]);
  } catch (error) {
    console.error("createUserWithComplexesAction failed:", error);
    return { error: dict.superAdmin.usersUploadFailed };
  }

  revalidatePath("/user-access");
  return { userId };
}

export async function updateUserAccessAction(input: {
  userId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  assignments: UserAccessAssignment[];
}): Promise<{ error?: string }> {
  const auth = await requireSuperAdminAction();
  if ("error" in auth) return { error: auth.error };
  const { dict } = auth;

  const parsed = baseUserSchema.extend({ userId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.flatten().fieldErrors;
    if (fields.assignments) return { error: dict.userAccess.complexesRequired };
    if (fields.email) return { error: dict.errors.invalidEmail };
    if (fields.userId) return { error: dict.errors.invalidInput };
    return { error: dict.errors.nameRequired };
  }
  const phone = parsePhone(parsed.data.phoneNumber);
  if (!phone.ok) return { error: dict.errors.invalidInput };

  const complexIds = parsed.data.assignments.map((item) => item.complexId);
  if (!(await allComplexesExist(complexIds))) return { error: dict.admin.complexNotFound };

  const email = parsed.data.email.toLocaleLowerCase();
  const [target, clash] = await Promise.all([
    usersSql`SELECT id FROM users WHERE id = ${parsed.data.userId} LIMIT 1`,
    usersSql`
      SELECT id FROM users
      WHERE lower(email) = ${email} AND id <> ${parsed.data.userId}
      LIMIT 1
    `,
  ]);
  if (target.length === 0) return { error: dict.errors.invalidInput };
  if (clash.length > 0) return { error: dict.superAdmin.usersEmailTaken };

  try {
    await usersSql.transaction([
      usersSql`
        UPDATE users
        SET full_name = ${parsed.data.fullName}, email = ${email}, phone_number = ${phone.value}
        WHERE id = ${parsed.data.userId}
      `,
      usersSql`DELETE FROM user_complex_permissions WHERE user_id = ${parsed.data.userId}`,
      ...parsed.data.assignments.map(
        (item) => usersSql`
          INSERT INTO user_complex_permissions (user_id, complex_id, role)
          VALUES (${parsed.data.userId}, ${item.complexId}, ${item.role})
        `,
      ),
    ]);
  } catch (error) {
    console.error("updateUserAccessAction failed:", error);
    return { error: dict.superAdmin.usersUploadFailed };
  }

  revalidatePath("/user-access");
  return {};
}
