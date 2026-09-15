"use client";

import { useActionState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createComplexAction, type CreateComplexState } from "@/app/actions/complexes";

const initialState: CreateComplexState = {};

export function CreateComplexModal({
  open,
  chains,
  onClose,
  onCreated,
}: {
  open: boolean;
  chains: { id: string; name: string }[];
  onClose: () => void;
  onCreated: (complex: { id: string; name: string }, seededAgents: number) => void;
}) {
  const [state, action, pending] = useActionState(createComplexAction, initialState);

  useEffect(() => {
    if (state.complex) {
      onCreated(state.complex, state.seededAgents ?? 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="סגירה"
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={pending ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-complex-title"
        className="surface-card relative z-10 w-full max-w-md rounded-t-2xl p-5 pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="create-complex-title" className="mb-4 text-lg font-semibold">
          מתחם חדש
        </h2>
        <form key={open ? "open" : "closed"} action={action} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="new-complex-name" className="field-label">
              שם המתחם
            </label>
            <input id="new-complex-name" name="name" type="text" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-complex-address" className="field-label">
              כתובת (אופציונלי)
            </label>
            <input id="new-complex-address" name="address" type="text" />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-complex-sqm" className="field-label">
              שטח במ״ר (אופציונלי)
            </label>
            <input id="new-complex-sqm" name="square_meters" type="number" min="0" step="0.01" />
          </div>
          {chains.length > 0 ? (
            <div className="space-y-1.5">
              <label htmlFor="new-complex-chain" className="field-label">
                רשת (אופציונלי)
              </label>
              <select id="new-complex-chain" name="chain_id" defaultValue="">
                <option value="">ללא רשת</option>
                {chains.map((chain) => (
                  <option key={chain.id} value={chain.id}>
                    {chain.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <p className="text-xs text-[var(--text-muted)]">
            סוכני ברירת המחדל של המערכת (ורשת, אם נבחרה) יועתקו אוטומטית למתחם החדש.
          </p>
          {state.error ? (
            <p className="banner-error" role="alert">
              {state.error}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn btn-secondary" disabled={pending} onClick={onClose}>
              ביטול
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary">
              {pending ? "יוצר…" : "יצירת מתחם"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
