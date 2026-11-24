"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  createUserWithComplexesAction,
  listUserAccessAction,
  updateUserAccessAction,
  type UserAccessAssignment,
  type UserAccessRow,
} from "@/app/actions/user-access";
import { useComplexContext } from "@/components/complex-context";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";

type FormState = {
  id: string | null;
  fullName: string;
  email: string;
  phoneNumber: string;
  password: string;
  assignments: UserAccessAssignment[];
};

const EMPTY_FORM: FormState = {
  id: null,
  fullName: "",
  email: "",
  phoneNumber: "",
  password: "",
  assignments: [],
};

export function UserAccessPanel({ dict }: { dict: Dictionary }) {
  const { complexes } = useComplexContext();
  const copy = dict.userAccess;
  const [multiOnly, setMultiOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [users, setUsers] = useState<UserAccessRow[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  const complexName = useMemo(
    () => new Map(complexes.map((complex) => [complex.id, complex.name])),
    [complexes],
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await listUserAccessAction({ multiOnly, search: debouncedSearch });
    setLoading(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setUsers(result.users ?? []);
    setTruncated(Boolean(result.truncated));
  }, [multiOnly, debouncedSearch]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {message ? <p className="banner-success">{message}</p> : null}
      {error ? <p className="banner-error" role="alert">{error}</p> : null}

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{copy.listTitle}</h2>
          <button
            type="button"
            className="btn btn-primary shrink-0"
            onClick={() => {
              setMessage(null);
              setForm({ ...EMPTY_FORM });
            }}
          >
            {copy.newUser}
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.searchPlaceholder}
            className="min-w-[14rem] flex-1"
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={multiOnly}
              onChange={(event) => setMultiOnly(event.target.checked)}
            />
            {copy.multiOnly}
          </label>
        </div>

        {loading && users.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">{dict.common.loading}</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">
            {multiOnly ? copy.emptyMulti : copy.empty}
          </p>
        ) : (
          <ul className="divide-y">
            {users.map((user) => (
              <li key={user.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-sm font-medium">{user.fullName}</p>
                  <p className="text-xs text-[var(--text-muted)]" dir="ltr">
                    {user.email}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {user.assignments.map((assignment) => (
                      <span
                        key={assignment.complexId}
                        className="rounded-full bg-[var(--surface-muted)] px-2 py-0.5 text-xs"
                      >
                        {complexName.get(assignment.complexId) ?? assignment.complexId}
                        {" · "}
                        {assignment.role === "admin" ? dict.roles.admin : dict.roles.user}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-[var(--text-muted)]">
                    {t(copy.complexCount, { count: user.assignments.length })}
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setMessage(null);
                      setForm({
                        id: user.id,
                        fullName: user.fullName,
                        email: user.email,
                        phoneNumber: user.phoneNumber,
                        password: "",
                        assignments: user.assignments,
                      });
                    }}
                  >
                    {dict.common.edit}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {truncated ? (
          <p className="text-xs text-[var(--text-muted)]">{copy.truncated}</p>
        ) : null}
      </section>

      {form ? (
        <UserAccessModal
          key={form.id ?? "new"}
          dict={dict}
          initial={form}
          complexes={complexes}
          onClose={() => setForm(null)}
          onSaved={(text) => {
            setForm(null);
            setMessage(text);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function UserAccessModal({
  dict,
  initial,
  complexes,
  onClose,
  onSaved,
}: {
  dict: Dictionary;
  initial: FormState;
  complexes: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const copy = dict.userAccess;
  const isEdit = initial.id !== null;
  const [values, setValues] = useState(initial);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roleByComplex = useMemo(
    () => new Map(values.assignments.map((item) => [item.complexId, item.role])),
    [values.assignments],
  );
  const visibleComplexes = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return needle
      ? complexes.filter((complex) => complex.name.toLocaleLowerCase().includes(needle))
      : complexes;
  }, [complexes, filter]);

  function toggle(complexId: string, checked: boolean) {
    setValues((current) => ({
      ...current,
      assignments: checked
        ? [...current.assignments, { complexId, role: "user" }]
        : current.assignments.filter((item) => item.complexId !== complexId),
    }));
  }

  function setRole(complexId: string, role: "user" | "admin") {
    setValues((current) => ({
      ...current,
      assignments: current.assignments.map((item) =>
        item.complexId === complexId ? { ...item, role } : item,
      ),
    }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (values.assignments.length === 0) {
      setError(copy.complexesRequired);
      return;
    }
    setPending(true);
    setError(null);
    const result = isEdit
      ? await updateUserAccessAction({
          userId: values.id!,
          fullName: values.fullName,
          email: values.email,
          phoneNumber: values.phoneNumber,
          assignments: values.assignments,
        })
      : await createUserWithComplexesAction({
          fullName: values.fullName,
          email: values.email,
          phoneNumber: values.phoneNumber,
          password: values.password,
          assignments: values.assignments,
        });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onSaved(`${isEdit ? copy.userUpdated : dict.superAdmin.userCreated}: ${values.fullName}`);
  }

  if (typeof document === "undefined") return null;

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
        className="surface-card relative z-10 flex max-h-[92dvh] w-full max-w-lg flex-col rounded-t-2xl p-5 pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:p-6"
      >
        <h2 className="mb-4 text-lg font-semibold">
          {isEdit ? copy.editUser : copy.newUser}
        </h2>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto">
            <div className="space-y-1.5">
              <label className="field-label" htmlFor="ua-name">
                {dict.superAdmin.createUserNameLabel}
              </label>
              <input
                id="ua-name"
                type="text"
                required
                autoFocus
                value={values.fullName}
                onChange={(event) => setValues({ ...values, fullName: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label" htmlFor="ua-email">
                {dict.superAdmin.createUserEmailLabel}
              </label>
              <input
                id="ua-email"
                type="email"
                required
                autoComplete="off"
                value={values.email}
                onChange={(event) => setValues({ ...values, email: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <label className="field-label" htmlFor="ua-phone">
                {dict.superAdmin.createUserPhoneLabel}
              </label>
              <input
                id="ua-phone"
                type="tel"
                inputMode="numeric"
                value={values.phoneNumber}
                onChange={(event) => setValues({ ...values, phoneNumber: event.target.value })}
              />
            </div>
            {!isEdit ? (
              <div className="space-y-1.5">
                <label className="field-label" htmlFor="ua-password">
                  {dict.superAdmin.createUserPasswordLabel}
                </label>
                <input
                  id="ua-password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  value={values.password}
                  onChange={(event) => setValues({ ...values, password: event.target.value })}
                />
              </div>
            ) : null}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="field-label">{copy.complexesLabel}</span>
                <span className="text-xs text-[var(--text-muted)]">
                  {t(copy.selectedCount, { count: values.assignments.length })}
                </span>
              </div>
              <input
                type="search"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={copy.filterComplexes}
              />
              <ul className="max-h-60 divide-y overflow-y-auto rounded-lg border">
                {visibleComplexes.map((complex) => {
                  const role = roleByComplex.get(complex.id);
                  return (
                    <li key={complex.id} className="flex items-center justify-between gap-2 px-3 py-2">
                      <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={role !== undefined}
                          onChange={(event) => toggle(complex.id, event.target.checked)}
                        />
                        <span className="truncate">{complex.name}</span>
                      </label>
                      {role !== undefined ? (
                        <select
                          aria-label={dict.superAdmin.createUserRoleLabel}
                          className="w-auto shrink-0"
                          value={role}
                          onChange={(event) =>
                            setRole(complex.id, event.target.value as "user" | "admin")
                          }
                        >
                          <option value="user">{dict.roles.user}</option>
                          <option value="admin">{dict.roles.admin}</option>
                        </select>
                      ) : null}
                    </li>
                  );
                })}
                {visibleComplexes.length === 0 ? (
                  <li className="px-3 py-2 text-sm text-[var(--text-muted)]">{copy.noComplexMatch}</li>
                ) : null}
              </ul>
            </div>
          </div>

          {error ? (
            <p className="banner-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
              {dict.common.cancel}
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {pending ? dict.common.loading : isEdit ? dict.common.save : dict.superAdmin.createUserSubmit}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
