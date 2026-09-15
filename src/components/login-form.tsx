"use client";

import { useActionState } from "react";
import Link from "next/link";
import {
  requestMagicLinkAction,
  verifyMagicCodeAction,
  type AuthFormState,
} from "@/app/actions/auth";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: AuthFormState = {};

export function LoginForm({
  dict,
  magicLinkInvalid = false,
  next = null,
}: {
  dict: Dictionary;
  magicLinkInvalid?: boolean;
  next?: string | null;
}) {
  const [magicState, magicAction, magicPending] = useActionState(
    requestMagicLinkAction,
    initialState,
  );
  const [codeState, codeAction, codePending] = useActionState(
    verifyMagicCodeAction,
    initialState,
  );

  return (
    <div className="space-y-5">
      {magicLinkInvalid && (
        <p className="banner-error" role="alert">
          {dict.login.magicLinkInvalid}
        </p>
      )}

      {!magicState?.codeSent ? (
        <form action={magicAction} className="space-y-4">
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="space-y-1">
            <h2 className="text-base font-semibold">{dict.login.magicLinkTitle}</h2>
            <p className="text-sm text-[var(--text-muted)]">{dict.login.magicLinkHint}</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="magic-email" className="field-label">
              {dict.login.email}
            </label>
            <input
              id="magic-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="name@example.com"
            />
          </div>
          {(magicState?.error || magicState?.success) && (
            <p className={magicState.error ? "banner-error" : "banner-success"} role="status">
              {magicState.error ?? magicState.success}
            </p>
          )}
          <button type="submit" disabled={magicPending} className="btn btn-primary w-full">
            {magicPending ? dict.login.magicLinkSubmitting : dict.login.magicLinkSubmit}
          </button>
        </form>
      ) : (
        <form action={codeAction} className="space-y-4">
          <input type="hidden" name="email" value={magicState.email} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <div className="space-y-1 text-center">
            <h2 className="text-base font-semibold">{dict.login.magicCodeTitle}</h2>
            <p className="text-sm text-[var(--text-muted)]">{dict.login.magicCodeHint}</p>
            <p className="text-xs text-[var(--text-muted)]" dir="ltr">
              {magicState.email}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="magic-code" className="field-label">
              {dict.login.magicCodeLabel}
            </label>
            <input
              id="magic-code"
              name="code"
              type="text"
              required
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              dir="ltr"
              className="text-center font-mono text-xl tracking-[0.35em]"
            />
          </div>
          {codeState?.error && (
            <p className="banner-error" role="alert">
              {codeState.error}
            </p>
          )}
          <button type="submit" disabled={codePending} className="btn btn-primary w-full">
            {codePending ? dict.login.magicCodeSubmitting : dict.login.magicCodeSubmit}
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="btn btn-secondary w-full"
          >
            {dict.login.magicCodeBack}
          </button>
          <p className="text-center text-xs text-[var(--text-muted)]">
            {dict.login.magicLinkAlternative}
          </p>
        </form>
      )}

      <div className="border-t pt-4 text-center">
        <Link
          href={next ? `/login/password?next=${encodeURIComponent(next)}` : "/login/password"}
          className="text-sm font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {dict.login.passwordLogin}
        </Link>
      </div>
    </div>
  );
}
