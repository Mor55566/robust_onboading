"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MISSION_EXPORT_SCRIPT } from "@/lib/mission-export-script";
import type { Dictionary } from "@/i18n/dictionaries/en";

export function ScheduledMissionsImportGuideModal({
  open,
  dict,
  onClose,
}: {
  open: boolean;
  dict: Dictionary;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleClose() {
    setCopied(false);
    onClose();
  }

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") handleClose();
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MISSION_EXPORT_SCRIPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={dict.common.close}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={handleClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduled-missions-import-guide-title"
        className="surface-card relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[85vh] sm:rounded-2xl"
      >
        <div className="shrink-0 border-b bg-[var(--surface)] px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="scheduled-missions-import-guide-title"
                className="text-lg font-semibold tracking-tight"
              >
                {dict.superAdmin.scheduledMissionsImportGuideTitle}
              </h2>
              <p className="mt-0.5 text-sm leading-snug text-[var(--text-muted)]">
                {dict.superAdmin.scheduledMissionsImportGuideIntro}
              </p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              aria-label={dict.common.close}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
          <GuideStep
            number={1}
            title={dict.superAdmin.scheduledMissionsImportGuideStep1Title}
            body={dict.superAdmin.scheduledMissionsImportGuideStep1Body}
          >
            <VisittScreenshot />
          </GuideStep>

          <GuideStep
            number={2}
            title={dict.superAdmin.scheduledMissionsImportGuideStep2Title}
            body={dict.superAdmin.scheduledMissionsImportGuideStep2Body}
          />

          <GuideStep
            number={3}
            title={dict.superAdmin.scheduledMissionsImportGuideStep3Title}
            body={dict.superAdmin.scheduledMissionsImportGuideStep3Body}
          >
            <code className="block w-fit rounded-lg bg-[var(--surface-muted)] px-3 py-1.5 text-sm font-mono">
              allow pasting
            </code>
          </GuideStep>

          <GuideStep
            number={4}
            title={dict.superAdmin.scheduledMissionsImportGuideStep4Title}
            body={dict.superAdmin.scheduledMissionsImportGuideStep4Body}
          >
            <div className="space-y-2">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="btn btn-secondary"
                >
                  {copied
                    ? dict.common.copied
                    : dict.superAdmin.scheduledMissionsImportGuideCopyScript}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-relaxed">
                <code dir="ltr" className="block text-start font-mono">
                  {MISSION_EXPORT_SCRIPT}
                </code>
              </pre>
              <p className="text-xs text-[var(--text-muted)]">
                {dict.superAdmin.scheduledMissionsImportGuideScriptNote}
              </p>
            </div>
          </GuideStep>
        </div>

        <div className="flex shrink-0 justify-end border-t bg-[var(--surface)] px-5 py-4 sm:px-6">
          <button type="button" onClick={handleClose} className="btn btn-secondary">
            {dict.common.close}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function GuideStep({
  number,
  title,
  body,
  children,
}: {
  number: number;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-sm font-semibold text-[var(--brand-hover)]">
        {number}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm leading-relaxed text-[var(--text-muted)]">{body}</p>
        {children}
      </div>
    </div>
  );
}

function VisittScreenshot() {
  const tableRows = [
    { y: 172 },
    { y: 202 },
    { y: 232 },
  ];
  return (
    <svg
      viewBox="0 0 700 320"
      className="w-full overflow-hidden rounded-lg border"
      role="img"
      aria-label="עמוד משימות ב-Visitt, עם טבלת המשימות המתוזמנות"
    >
      <rect width="700" height="320" fill="#ffffff" />

      {/* main content area */}
      <text x="610" y="27" textAnchor="end" fontSize="15" fontWeight="700" fill="#111827">
        משימות
      </text>
      <rect x="486" y="12" width="100" height="24" rx="12" fill="#ffffff" stroke="#d1d5db" />
      <text x="536" y="27" textAnchor="middle" fontSize="9" fill="#374151">
        מרכז ידע
      </text>
      <rect x="14" y="12" width="112" height="26" rx="6" fill="#1a7f5a" />
      <text x="70" y="29" textAnchor="middle" fontSize="10.5" fill="#ffffff" fontWeight="600">
        + משימה חדשה
      </text>

      {/* tabs row */}
      {[
        ["תבניות", 280],
        ["אוטומציה", 350],
        ["יומן", 410],
      ].map(([label, x]) => (
        <text key={label} x={x} y="60" textAnchor="end" fontSize="8.5" fill="#6b7280">
          {label}
        </text>
      ))}
      <text x="610" y="60" textAnchor="end" fontSize="8.5" fontWeight="700" fill="#1a7f5a">
        כל המשימות
      </text>
      <line x1="0" y1="72" x2="630" y2="72" stroke="#e5e7eb" />

      {/* search bar */}
      <rect x="14" y="86" width="596" height="24" rx="6" fill="#ffffff" stroke="#d1d5db" />
      <text x="592" y="102" textAnchor="end" fontSize="8.5" fill="#9ca3af">
        שם משימה, מיקום או #
      </text>

      {/* filter row */}
      <text x="14" y="132" fontSize="8.5" fill="#6b7280">
        12 תוצאות
      </text>
      {[
        ["הוסף סינון +", 610],
        ["קטגוריה ⌄", 520],
        ["בניין ⌄", 450],
        ["תדירות ⌄", 390],
      ].map(([label, x]) => (
        <rect key={label} x={Number(x) - 70} y="120" width="70" height="20" rx="10" fill="#f3f4f6" />
      ))}
      {[
        ["הוסף סינון +", 610],
        ["קטגוריה ⌄", 520],
        ["בניין ⌄", 450],
        ["תדירות ⌄", 390],
      ].map(([label, x]) => (
        <text key={label} x={Number(x) - 35} y="134" textAnchor="middle" fontSize="8" fill="#374151">
          {label}
        </text>
      ))}

      {/* table header */}
      <line x1="0" y1="150" x2="630" y2="150" stroke="#e5e7eb" />
      {[
        ["#", 610],
        ["תדירות", 570],
        ["בניין", 470],
        ["מיקומים", 400],
        ["שם המשימה", 290],
        ["קטגוריה", 190],
        ["משתמש משויך", 80],
      ].map(([label, x]) => (
        <text key={label} x={x} y="163" textAnchor="middle" fontSize="7.5" fontWeight="600" fill="#6b7280">
          {label}
        </text>
      ))}
      <line x1="0" y1="172" x2="630" y2="172" stroke="#e5e7eb" />

      {/* table rows, with an arrow pointing at the assignment link in column 2 */}
      {tableRows.map((row, i) => (
        <g key={row.y}>
          {i % 2 === 1 ? <rect x="0" y={row.y - 16} width="630" height="30" fill="#fafafa" /> : null}
          <rect x="240" y={row.y - 6} width="140" height="8" rx="2" fill="#eef2ff" />
          <rect x="130" y={row.y - 6} width="90" height="8" rx="2" fill="#e5e7eb" />
          <circle cx="105" cy={row.y} r="9" fill="#c7d2fe" />
          <circle cx="80" cy={row.y} r="9" fill="#bfdbfe" />
          <circle cx="55" cy={row.y} r="9" fill="#bbf7d0" />
          <circle cx="30" cy={row.y} r="9" fill="#fecdd3" />
          <line x1="0" y1={row.y + 15} x2="630" y2={row.y + 15} stroke="#f1f5f9" />
        </g>
      ))}
      <path
        d="M 340 189 L 470 260"
        stroke="#e11d1d"
        strokeWidth="2.5"
        fill="none"
        markerEnd="url(#arrowhead)"
      />
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#e11d1d" />
        </marker>
      </defs>
      <text x="630" y="278" textAnchor="end" fontSize="9" fill="#e11d1d" fontWeight="600">
        טבלת המשימות המתוזמנות
      </text>

      {/* right sidebar (Visitt nav) */}
      <line x1="630" y1="0" x2="630" y2="320" stroke="#e5e7eb" />
      <rect x="630" y="0" width="70" height="320" fill="#fcfcfd" />
      <text x="665" y="22" textAnchor="middle" fontSize="9" fontWeight="700" fill="#111827">
        ✓ visitt
      </text>
      {[40, 56, 72, 88].map((y) => (
        <rect key={y} x="640" y={y} width="50" height="6" rx="3" fill="#e5e7eb" />
      ))}
      <rect x="632" y="104" width="66" height="20" fill="#f4e9ef" />
      <text x="695" y="118" textAnchor="end" fontSize="8" fontWeight="700" fill="#3f3f46">
        משימות
      </text>
      {[140, 156, 184, 200, 216].map((y) => (
        <rect key={y} x="640" y={y} width="46" height="6" rx="3" fill="#eef0f2" />
      ))}
      <circle cx="665" cy="298" r="11" fill="#8b7bd8" />
      <text x="665" y="301" textAnchor="middle" fontSize="7" fill="#ffffff" fontWeight="700">
        מז
      </text>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
