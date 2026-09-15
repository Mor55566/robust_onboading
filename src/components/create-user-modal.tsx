"use client";

import { useActionState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createUserAction, type CreateUserState } from "@/app/actions/super-admin";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: CreateUserState = {};

export function CreateUserModal({
  open,
  complexId,
  dict,
  onClose,
  onCreated,
}: {
  open: boolean;
  complexId: string;
  dict: Dictionary;
  onClose: () => void;
  onCreated: (user: { id: string; fullName: string; email: string }) => void;
}) {
  const [state, action, pending] = useActionState(createUserAction, initialState);

  useEffect(() => {
    if (state.user) {
      onCreated(state.user);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={dict.common.close}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={pending ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-title"
        className="surface-card relative z-10 w-full max-w-md rounded-t-2xl p-5 pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="create-user-title" className="mb-4 text-lg font-semibold">
          {dict.superAdmin.usersAddNew}
        </h2>
        <form key={open ? "open" : "closed"} action={action} className="space-y-4">
          <input type="hidden" name="complex_id" value={complexId} />
          <div className="space-y-1.5">
            <label htmlFor="new-user-name" className="field-label">
              {dict.superAdmin.createUserNameLabel}
            </label>
            <input id="new-user-name" name="full_name" type="text" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-user-email" className="field-label">
              {dict.superAdmin.createUserEmailLabel}
            </label>
            <input id="new-user-email" name="email" type="email" required autoComplete="off" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-user-phone" className="field-label">
              {dict.superAdmin.createUserPhoneLabel}
            </label>
            <input id="new-user-phone" name="phone_number" type="tel" inputMode="numeric" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-user-role" className="field-label">
              {dict.superAdmin.createUserRoleLabel}
            </label>
            <select id="new-user-role" name="role" defaultValue="user">
              <option value="user">{dict.roles.user}</option>
              <option value="admin">{dict.roles.admin}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-user-password" className="field-label">
              {dict.superAdmin.createUserPasswordLabel}
            </label>
            <input
              id="new-user-password"
              name="password"
              type="password"
              minLength={8}
              autoComplete="new-password"
              required
              placeholder={dict.superAdmin.usersImportPasswordPlaceholder}
            />
          </div>
          {state.error ? (
            <p className="banner-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
              {dict.common.cancel}
            </button>
            <button type="submit" disabled={pending || !complexId} className="btn btn-primary">
              {pending ? dict.admin.creating : dict.superAdmin.createUserSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
