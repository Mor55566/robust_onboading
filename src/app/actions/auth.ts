"use server";

// Based on with_robust_app's src/app/actions/auth.ts. This app is the
// super-admin-only onboarding tool, so every path that would end in
// createSession() additionally rejects non-super_admin accounts via
// isSuperAdminUserId() below, before a session cookie is ever issued.
// updateNameAction/updatePasswordAction were dropped — they back the
// self-service profile page, which this app doesn't have.

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  authenticateUser,
  createMagicLinkToken,
  createSession,
  deleteSession,
  discardMagicLinkToken,
  hashPassword,
  consumeMagicCode,
  consumeMagicLinkToken,
} from "@/lib/auth";
import { sendMagicLinkEmail, sendPasswordResetEmail } from "@/lib/mailer";
import { usersSql as sql } from "@/lib/users-db";
import { getDictionary, getLocale } from "@/i18n/get-dictionary";
import { postLoginPath } from "@/lib/native-app";
import { isSuperAdminUserId } from "@/lib/onboarding-auth";

export type AuthFormState = {
  error?: string;
  success?: string;
  codeSent?: boolean;
  email?: string;
};

export async function loginAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const loginSchema = z.object({
    email: z.email(dict.errors.invalidEmail),
    password: z.string().min(1, dict.errors.passwordRequired),
  });

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? dict.errors.invalidInput,
    };
  }

  const user = await authenticateUser(
    parsed.data.email,
    parsed.data.password,
  );

  if (!user) {
    return { error: dict.errors.invalidCredentials };
  }

  if (user.role !== "super_admin") {
    return { error: dict.errors.unauthorized };
  }

  await createSession(user.id);
  redirect(postLoginPath(String(formData.get("next") ?? "")));
}

export async function requestMagicLinkAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const parsed = z.email(dict.errors.invalidEmail).safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const email = parsed.data.toLowerCase();
  const tokenResult = await createMagicLinkToken(email);
  if (tokenResult.status === "rate_limited") {
    return { error: dict.errors.magicLinkRateLimited };
  }

  if (tokenResult.status === "created") {
    const { token } = tokenResult;
    try {
      const originHeader = (await headers()).get("origin");
      if (!originHeader) throw new Error("Request origin is missing");
      const origin = new URL(originHeader);
      if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        throw new Error("Request origin is invalid");
      }

      const locale = await getLocale();
      const link = new URL("/login/magic", origin);
      link.searchParams.set("token", token);
      const next = postLoginPath(String(formData.get("next") ?? ""));
      if (next !== "/") link.searchParams.set("next", next);
      await sendMagicLinkEmail({ email, link: link.toString(), code: tokenResult.code, locale });
    } catch (error) {
      await discardMagicLinkToken(token);
      console.error("Failed to send magic link email", error);
      return { error: dict.errors.magicLinkUnavailable };
    }
  }

  return { success: dict.login.magicLinkSent, codeSent: true, email };
}

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const parsed = z.email(dict.errors.invalidEmail).safeParse(formData.get("email"));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const email = parsed.data.toLowerCase();
  const tokenResult = await createMagicLinkToken(email);
  if (tokenResult.status === "rate_limited") {
    return { error: dict.errors.magicLinkRateLimited };
  }

  if (tokenResult.status === "created") {
    const { token } = tokenResult;
    try {
      const originHeader = (await headers()).get("origin");
      if (!originHeader) throw new Error("Request origin is missing");
      const origin = new URL(originHeader);
      if (origin.protocol !== "http:" && origin.protocol !== "https:") {
        throw new Error("Request origin is invalid");
      }

      const locale = await getLocale();
      const link = new URL("/login/reset-password", origin);
      link.searchParams.set("token", token);
      await sendPasswordResetEmail({ email, link: link.toString(), locale });
    } catch (error) {
      await discardMagicLinkToken(token);
      console.error("Failed to send password reset email", error);
      return { error: dict.errors.magicLinkUnavailable };
    }
  }

  return { success: dict.login.passwordResetSent };
}

export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const resetSchema = z
    .object({
      token: z.string().min(1, dict.errors.resetLinkInvalid),
      new_password: z.string().min(8, dict.errors.passwordMin),
      confirm_password: z.string().min(1, dict.errors.passwordRequired),
    })
    .refine((data) => data.new_password === data.confirm_password, {
      path: ["confirm_password"],
      message: dict.errors.passwordMismatch,
    });

  const parsed = resetSchema.safeParse({
    token: formData.get("token"),
    new_password: formData.get("new_password"),
    confirm_password: formData.get("confirm_password"),
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? dict.errors.invalidInput,
    };
  }

  const userId = await consumeMagicLinkToken(parsed.data.token);
  if (!userId) {
    return { error: dict.errors.resetLinkInvalid };
  }

  if (!(await isSuperAdminUserId(userId))) {
    return { error: dict.errors.unauthorized };
  }

  const newPasswordHash = await hashPassword(parsed.data.new_password);
  await sql`
    UPDATE users
    SET password_hash = ${newPasswordHash}
    WHERE id = ${userId}
  `;

  await createSession(userId);
  redirect("/");
}

export async function verifyMagicCodeAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const dict = await getDictionary();
  const parsed = z.object({
    email: z.email(dict.errors.invalidEmail),
    code: z.string().regex(/^\d{6}$/, dict.errors.magicCodeInvalid),
  }).safeParse({ email: formData.get("email"), code: formData.get("code") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  const userId = await consumeMagicCode(parsed.data.email.toLowerCase(), parsed.data.code);
  if (!userId) return { error: dict.errors.magicCodeInvalid };

  if (!(await isSuperAdminUserId(userId))) {
    return { error: dict.errors.unauthorized };
  }

  await createSession(userId);
  redirect(postLoginPath(String(formData.get("next") ?? "")));
}

export async function logoutAction() {
  await deleteSession();
  redirect("/login");
}
