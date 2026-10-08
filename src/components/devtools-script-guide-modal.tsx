"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/i18n/dictionaries/en";

export type DevtoolsScriptGuideCopy = {
  title: string;
  intro: string;
  step1Title: string;
  step1Body: string;
  step4Title: string;
  step4Body: string;
  scriptNote: string;
};

/**
 * Step-by-step guide for exporting data from Visitt: open DevTools, allow
 * pasting, then copy & run an export script in the Console.
 */
export function DevtoolsScriptGuideModal({
  open,
  dict,
  script,
  copy,
  onClose,
}: {
  open: boolean;
  dict: Dictionary;
  script: string;
  copy: DevtoolsScriptGuideCopy;
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
      await navigator.clipboard.writeText(script);
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
        aria-labelledby="devtools-script-guide-title"
        className="surface-card relative z-10 flex w-full max-w-xl flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:max-h-[85vh] sm:rounded-2xl"
      >
        <div className="shrink-0 border-b bg-[var(--surface)] px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2
                id="devtools-script-guide-title"
                className="text-lg font-semibold tracking-tight"
              >
                {copy.title}
              </h2>
              <p className="mt-0.5 text-sm leading-snug text-[var(--text-muted)]">
                {copy.intro}
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
            title={copy.step1Title}
            body={copy.step1Body}
          />

          <GuideStep
            number={2}
            title={dict.superAdmin.fileTagsImportGuideStep2Title}
            body={dict.superAdmin.fileTagsImportGuideStep2Body}
          />

          <GuideStep
            number={3}
            title={dict.superAdmin.fileTagsImportGuideStep3Title}
            body={dict.superAdmin.fileTagsImportGuideStep3Body}
          >
            <code className="block w-fit rounded-lg bg-[var(--surface-muted)] px-3 py-1.5 text-sm font-mono">
              allow pasting
            </code>
          </GuideStep>

          <GuideStep
            number={4}
            title={copy.step4Title}
            body={copy.step4Body}
          >
            <div className="space-y-2">
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  className="btn btn-secondary"
                >
                  {copied ? dict.common.copied : dict.superAdmin.fileTagsImportGuideCopyScript}
                </button>
              </div>
              <pre className="max-h-64 overflow-auto rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-relaxed">
                <code dir="ltr" className="block text-start font-mono">
                  {script}
                </code>
              </pre>
              <p className="text-xs text-[var(--text-muted)]">
                {copy.scriptNote}
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
