"use client";

import Link from "next/link";
import { useActionState } from "react";
import { resetPasswordAction, type AuthFormState } from "@/app/actions/auth";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: AuthFormState = {};

export function ResetPasswordForm({ dict, token }: { dict: Dictionary; token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, initialState);

  return (
    <div className="space-y-5">
      <form action={action} className="space-y-4">
        <input type="hidden" name="token" value={token} />
        <div className="space-y-1.5">
          <label htmlFor="new_password" className="field-label">
            {dict.profile.newPassword}
          </label>
          <input
            id="new_password"
            name="new_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="confirm_password" className="field-label">
            {dict.profile.confirmPassword}
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {state?.error && (
          <p className="banner-error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? dict.login.resetPasswordSubmitting : dict.login.resetPasswordSubmit}
        </button>
      </form>
      <div className="border-t pt-4 text-center">
        <Link
          href="/login/password"
          className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {dict.login.backToPasswordLogin}
        </Link>
      </div>
    </div>
  );
}
