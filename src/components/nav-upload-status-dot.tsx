"use client";

import { useComplexContext } from "@/components/complex-context";
import type { OnboardingSection } from "@/components/dashboard-shell";
import { SECTION_UPLOAD_KEYS } from "@/lib/upload-status-keys";

export function NavUploadStatusDot({ section }: { section: OnboardingSection }) {
  const { uploadStatus, complexId } = useComplexContext();
  const keys = SECTION_UPLOAD_KEYS[section];
  if (!keys || keys.length === 0 || !complexId || !uploadStatus) return null;

  const doneCount = keys.filter((key) => uploadStatus[key]).length;
  const percent = Math.round((doneCount / keys.length) * 100);

  return (
    <span
      role="img"
      aria-label={`${percent}% הועלה`}
      title={`${percent}% הועלה`}
      className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums ${
        percent === 100
          ? "bg-[var(--success-soft)] text-[var(--success)]"
          : percent > 0
            ? "bg-[var(--brand-soft)] text-[var(--brand)]"
            : "bg-[var(--surface-muted)] text-[var(--text-muted)]"
      }`}
    >
      {percent}%
    </span>
  );
}
