"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestPasswordResetAction, type AuthFormState } from "@/app/actions/auth";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: AuthFormState = {};

export function ForgotPasswordForm({ dict }: { dict: Dictionary }) {
  const [state, action, pending] = useActionState(requestPasswordResetAction, initialState);

  return (
    <div className="space-y-5">
      {!state?.success ? (
        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="email" className="field-label">
              {dict.login.email}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
            />
          </div>
          {state?.error && (
            <p className="banner-error" role="alert">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className="btn btn-primary w-full">
            {pending ? dict.login.forgotPasswordSubmitting : dict.login.forgotPasswordSubmit}
          </button>
        </form>
      ) : (
        <p className="banner-success" role="status">
          {state.success}
        </p>
      )}
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
