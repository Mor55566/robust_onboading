"use client";

import Link from "next/link";
import { useActionState, useTransition, type FormEvent } from "react";
import { loginAction, type AuthFormState } from "@/app/actions/auth";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: AuthFormState = {};

export function PasswordLoginForm({
  dict,
  next = null,
}: {
  dict: Dictionary;
  next?: string | null;
}) {
  const [state, action] = useActionState(loginAction, initialState);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(() => {
      action(formData);
    });
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        {next ? <input type="hidden" name="next" value={next} /> : null}
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
        <div className="space-y-1.5">
          <label htmlFor="password" className="field-label">
            {dict.login.password}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </div>
        {state?.error && (
          <p className="banner-error" role="alert">
            {state.error}
          </p>
        )}
        <button type="submit" disabled={pending} className="btn btn-primary w-full">
          {pending ? dict.login.submitting : dict.login.submit}
        </button>
        <div className="text-center">
          <Link
            href="/login/forgot-password"
            className="text-sm font-medium text-[var(--brand)] hover:text-[var(--brand-hover)]"
          >
            {dict.login.forgotPassword}
          </Link>
        </div>
      </form>
      <div className="border-t pt-4 text-center">
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {dict.login.backToMagicLink}
        </Link>
      </div>
    </div>
  );
}
