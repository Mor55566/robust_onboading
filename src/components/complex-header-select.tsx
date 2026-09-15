"use client";

import { useState } from "react";
import { useComplexContext } from "@/components/complex-context";
import { CreateComplexModal } from "@/components/create-complex-modal";

export function ComplexHeaderSelect() {
  const { complexId, setComplexId, complexes, chains, addComplex } = useComplexContext();
  const [modalOpen, setModalOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="hidden shrink-0 text-xs font-medium text-[var(--text-muted)] sm:inline">
        מתחם פעיל:
      </span>
      <select
        aria-label="מתחם פעיל"
        value={complexId}
        onChange={(event) => setComplexId(event.target.value)}
        className="min-w-0 max-w-[14rem] flex-1 !py-1.5 text-sm sm:flex-initial"
      >
        <option value="" disabled>
          בחרו מתחם…
        </option>
        {complexes.map((complex) => (
          <option key={complex.id} value={complex.id}>
            {complex.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-secondary shrink-0 !px-2.5 !py-1.5 text-xs"
        onClick={() => setModalOpen(true)}
      >
        + מתחם חדש
      </button>

      {notice ? (
        <span className="hidden truncate text-xs text-[var(--success)] md:inline">{notice}</span>
      ) : null}

      <CreateComplexModal
        open={modalOpen}
        chains={chains}
        onClose={() => setModalOpen(false)}
        onCreated={(complex, seededAgents) => {
          addComplex(complex);
          setModalOpen(false);
          setNotice(
            seededAgents > 0
              ? `"${complex.name}" נוצר, ${seededAgents} סוכני ברירת מחדל הועתקו.`
              : `"${complex.name}" נוצר.`,
          );
        }}
      />
    </div>
  );
}
