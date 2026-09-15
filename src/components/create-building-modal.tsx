"use client";

import { useActionState, useEffect } from "react";
import { createPortal } from "react-dom";
import { createBuildingAction, type CreateBuildingState } from "@/app/actions/buildings";
import type { Dictionary } from "@/i18n/dictionaries/en";

const initialState: CreateBuildingState = {};

export function CreateBuildingModal({
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
  onCreated: (building: { id: string; name: string }) => void;
}) {
  const [state, action, pending] = useActionState(createBuildingAction, initialState);

  useEffect(() => {
    if (state.building) {
      onCreated(state.building);
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
        aria-labelledby="create-building-title"
        className="surface-card relative z-10 w-full max-w-md rounded-t-2xl p-5 pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl sm:p-6"
      >
        <h2 id="create-building-title" className="mb-4 text-lg font-semibold">
          {dict.admin.newBuilding}
        </h2>
        <form key={open ? "open" : "closed"} action={action} className="space-y-4">
          <input type="hidden" name="complex_id" value={complexId} />
          <div className="space-y-1.5">
            <label htmlFor="new-building-name" className="field-label">
              {dict.admin.buildingNameLabel}
            </label>
            <input id="new-building-name" name="name" type="text" required autoFocus />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="new-building-address" className="field-label">
              {dict.admin.buildingAddressLabel}
            </label>
            <input id="new-building-address" name="address" type="text" />
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
              {pending ? dict.admin.creating : dict.admin.createBuilding}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
