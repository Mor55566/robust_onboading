"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  buildCsvOfRows,
  downloadTextFile,
  type ImportParseError,
} from "@/lib/data-import";
import { isZipFile, xlsxToCsv } from "@/lib/xlsx-reader";

export type DataUploadCopy = {
  title: string;
  subtitle: string;
  empty: string;
  invalid: string;
  invalidRow: string;
  missingDescription?: string;
};

export type ImportPreviewRow = {
  key: string;
  label: string;
  detail?: string;
  /** "error" = won't be uploaded due to a problem (e.g. an unresolved floor) — always shown, highlighted red. */
  action: "create" | "update" | "skip" | "error";
};

export type ImportProgressCounts = {
  done: number;
  total: number;
};

/** A row the import skipped; `rowNumber` is the file row (header = 1). */
export type ImportFailure = {
  rowNumber: number;
  label?: string;
  error: string;
};

/**
 * What onImport can resolve to: nothing (success, close), a blocking error, or
 * a finished import where some rows failed — shown in a results view with a
 * CSV of just those rows.
 */
export type ImportOutcome =
  | void
  | { error: string }
  | { failures: ImportFailure[]; succeeded: number };

export function DataUploadModal<T>({
  open,
  dict,
  copy,
  csvFilename,
  excelFilename,
  buildCsv,
  buildExcel,
  parse,
  preview,
  previewAsync,
  hideSkippedRows = false,
  extraFields,
  canImport = true,
  onClose,
  onImport,
}: {
  open: boolean;
  dict: Dictionary;
  copy: DataUploadCopy;
  csvFilename: string;
  excelFilename: string;
  buildCsv: () => string;
  buildExcel: () => string;
  parse: (
    content: string,
    fileName: string,
  ) =>
    | { rows: T[] }
    | { error: ImportParseError; message?: string };
  preview?: (rows: T[]) => ImportPreviewRow[];
  previewAsync?: (
    rows: T[],
  ) => Promise<ImportPreviewRow[] | { error: string }>;
  hideSkippedRows?: boolean;
  /** Extra controls rendered above the template download buttons (e.g. a building picker). */
  extraFields?: ReactNode;
  /** When false, blocks import even once a valid file is parsed (e.g. a required field in extraFields isn't set). */
  canImport?: boolean;
  onClose: () => void;
  onImport: (
    rows: T[],
    reportProgress: (
      percent: number,
      counts?: ImportProgressCounts,
    ) => void,
  ) => ImportOutcome | Promise<ImportOutcome>;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [failureResult, setFailureResult] = useState<{
    failures: ImportFailure[];
    succeeded: number;
  } | null>(null);
  const [parsedRows, setParsedRows] = useState<T[] | null>(null);
  const [previewRows, setPreviewRows] = useState<ImportPreviewRow[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);
  const [importCounts, setImportCounts] = useState<ImportProgressCounts | null>(
    null,
  );
  const [confirmingSkip, setConfirmingSkip] = useState(false);
  const [showErrorRows, setShowErrorRows] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (showErrorRows) setShowErrorRows(false);
      else onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose, showErrorRows]);

  useEffect(() => {
    if (open) return;
    setSelectedFile(null);
    setFileContent(null);
    setFailureResult(null);
    setParsedRows(null);
    setPreviewRows(null);
    setError(null);
    setIsReading(false);
    setIsImporting(false);
    setImportProgress(null);
    setImportCounts(null);
    setConfirmingSkip(false);
    setShowErrorRows(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open]);

  if (!open) return null;

  const createCount =
    previewRows?.filter((row) => row.action === "create").length ?? 0;
  const updateCount =
    previewRows?.filter((row) => row.action === "update").length ?? 0;
  const skipCount =
    previewRows?.filter((row) => row.action === "skip").length ?? 0;
  const errorCount =
    previewRows?.filter((row) => row.action === "error").length ?? 0;
  const hasPreview = previewRows != null && parsedRows != null;
  const visiblePreviewRows = hideSkippedRows
    ? previewRows?.filter((row) => row.action !== "skip") ?? []
    : previewRows ?? [];

  function handleDownloadCsv() {
    downloadTextFile(csvFilename, buildCsv(), "text/csv;charset=utf-8");
  }

  function handleDownloadExcel() {
    downloadTextFile(
      excelFilename,
      buildExcel(),
      "application/vnd.ms-excel",
    );
  }

  function handleDownloadFailedRows() {
    if (!failureResult || !selectedFile || fileContent == null) return;
    const csv = buildCsvOfRows(
      fileContent,
      selectedFile.name,
      failureResult.failures.map((failure) => failure.rowNumber),
    );
    if (csv == null) return;
    const baseName = selectedFile.name.replace(/\.[^.]+$/, "");
    downloadTextFile(`${baseName}-failed.csv`, csv, "text/csv;charset=utf-8");
  }

  function clearSelectedFile() {
    setSelectedFile(null);
    setFileContent(null);
    setParsedRows(null);
    setPreviewRows(null);
    setError(null);
    setConfirmingSkip(false);
    setShowErrorRows(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleFileChange(file: File | null) {
    setSelectedFile(file);
    setFileContent(null);
    setParsedRows(null);
    setPreviewRows(null);
    setError(null);
    setConfirmingSkip(false);
    setShowErrorRows(false);
    if (!file) return;

    setIsReading(true);
    try {
      // Real .xlsx files are ZIP archives: convert their first sheet to CSV
      // so every parser below reads them like a CSV upload.
      const buffer = await file.arrayBuffer();
      let content: string;
      let fileName = file.name;
      if (isZipFile(new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)))) {
        const csv = await xlsxToCsv(buffer);
        if (csv === null) {
          setError(copy.invalid);
          return;
        }
        content = csv;
        fileName = fileName.replace(/\.xlsx?$/i, "") + ".csv";
      } else {
        content = await file.text();
      }
      setFileContent(content);
      const parsed = parse(content, fileName);
      if ("error" in parsed) {
        setError(
          parsed.message ??
            (parsed.error === "empty"
              ? copy.empty
              : parsed.error === "invalidRow"
                ? copy.invalidRow
                : copy.invalid),
        );
        return;
      }
      setParsedRows(parsed.rows);
      if (previewAsync) {
        const previewResult = await previewAsync(parsed.rows);
        if ("error" in previewResult) {
          setError(previewResult.error);
          return;
        }
        setPreviewRows(previewResult);
      } else if (preview) {
        setPreviewRows(preview(parsed.rows));
      } else {
        setError(copy.invalid);
      }
    } catch {
      setError(copy.invalid);
    } finally {
      setIsReading(false);
    }
  }

  async function handleImport() {
    if (!parsedRows || isImporting) return;
    setError(null);
    setIsImporting(true);
    setImportProgress(null);
    setImportCounts(null);
    let lastProgress: number | null = null;

    try {
      const result = await onImport(parsedRows, (percent, counts) => {
        const normalized = Math.max(0, Math.min(100, Math.round(percent)));
        lastProgress = normalized;
        setImportProgress(normalized);
        if (counts) {
          setImportCounts({
            done: Math.max(0, counts.done),
            total: Math.max(0, counts.total),
          });
        }
      });
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      if (result && "failures" in result && result.failures.length > 0) {
        setFailureResult(result);
        return;
      }
      if (lastProgress === 100) {
        await new Promise((resolve) => window.setTimeout(resolve, 300));
      }
      onClose();
    } catch {
      setError(dict.admin.uploadImportFailed);
    } finally {
      setIsImporting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={dict.common.close}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-upload-title"
        className="surface-card relative z-10 flex w-full max-w-lg flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl"
      >
        <div className="shrink-0 border-b bg-[var(--surface)] px-5 pb-4 pt-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="data-upload-title" className="text-lg font-semibold tracking-tight">
                {copy.title}
              </h2>
              <p className="mt-0.5 text-sm leading-snug text-[var(--text-muted)]">
                {copy.subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={dict.common.close}
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
            >
              <CloseIcon />
            </button>
          </div>
        </div>

        {failureResult ? (
          <ImportFailuresView dict={dict} result={failureResult} />
        ) : (
        <div className="space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {extraFields}

          <div className="space-y-2">
            <p className="field-label">{dict.admin.uploadTemplateLabel}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={handleDownloadCsv} className="btn btn-secondary">
                {dict.admin.uploadDownloadCsv}
              </button>
              <button type="button" onClick={handleDownloadExcel} className="btn btn-secondary">
                {dict.admin.uploadDownloadExcel}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="data-upload-file" className="field-label">
              {dict.admin.uploadChooseFile}
            </label>
            <input
              ref={fileInputRef}
              id="data-upload-file"
              type="file"
              accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel"
              onChange={(event) => {
                void handleFileChange(event.target.files?.[0] ?? null);
              }}
              className="block w-full cursor-pointer text-sm text-[var(--text-muted)] file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-[var(--surface-muted)] file:px-3 file:py-2 file:text-sm file:font-medium file:text-[var(--text)] hover:file:opacity-80"
            />
            <p className="text-xs text-[var(--text-muted)]">{dict.admin.uploadHint}</p>
          </div>

          {isReading ? (
            <p className="text-sm text-[var(--text-muted)]" role="status">
              {dict.admin.uploadReviewing}
            </p>
          ) : null}

          {error ? (
            <p className="banner-error" role="alert">
              {error}
            </p>
          ) : null}

          {hasPreview ? (
            <div className="space-y-3">
              <div className="rounded-xl border px-3 py-2 text-sm" style={{ borderColor: "color-mix(in srgb, var(--brand) 30%, transparent)", background: "var(--brand-soft)", color: "var(--brand-hover)" }}>
                <p className="font-medium">{dict.admin.uploadPreviewTitle}</p>
                <p className="mt-0.5">
                  {[
                    t(dict.admin.uploadPreviewSummary, {
                      create: createCount,
                      update: updateCount,
                    }),
                    skipCount > 0
                      ? t(dict.admin.uploadPreviewSummarySkipPart, { skip: skipCount })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  {errorCount > 0 ? (
                    <>
                      {" · "}
                      <button
                        type="button"
                        onClick={() => setShowErrorRows(true)}
                        className="font-semibold underline underline-offset-2"
                        style={{ color: "var(--danger)" }}
                      >
                        {t(dict.admin.uploadPreviewSummaryErrorPart, { error: errorCount })}
                      </button>
                    </>
                  ) : null}
                </p>
              </div>

              {visiblePreviewRows.length > 0 ? (
                <ul className="max-h-64 divide-y overflow-y-auto rounded-xl border">
                  {visiblePreviewRows.map((row) => (
                    <li
                      key={row.key}
                      className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm"
                      style={
                        row.action === "error"
                          ? { background: "var(--danger-soft)", color: "var(--danger)" }
                          : undefined
                      }
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{row.label}</p>
                        {row.detail ? (
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-xs text-[var(--text-muted)]">
                            {row.detail}
                          </p>
                        ) : null}
                      </div>
                      <span
                        className="shrink-0 rounded-md px-2 py-0.5 text-xs font-medium"
                        style={
                          row.action === "create"
                            ? { background: "var(--success-soft)", color: "var(--success)" }
                            : row.action === "update"
                              ? { background: "#fef3c7", color: "#92400e" }
                              : row.action === "error"
                                ? { background: "var(--danger-soft)", color: "var(--danger)" }
                                : { background: "var(--surface-muted)", color: "var(--text-muted)" }
                        }
                      >
                        {row.action === "create"
                          ? dict.admin.uploadPreviewCreate
                          : row.action === "update"
                            ? dict.admin.uploadPreviewUpdate
                            : row.action === "error"
                              ? dict.admin.uploadPreviewError
                              : dict.admin.uploadPreviewSkip}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}

              {selectedFile ? (
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  className="text-sm font-medium text-[var(--brand-strong)] hover:text-[var(--brand-hover)]"
                >
                  {dict.admin.uploadChooseAnother}
                </button>
              ) : null}
            </div>
          ) : selectedFile && !isReading && !error ? (
            <p className="text-sm text-[var(--text-muted)]" role="status">
              {t(dict.admin.uploadSelected, { name: selectedFile.name })}
            </p>
          ) : null}
        </div>
        )}

        <div className="flex shrink-0 flex-col gap-3 border-t bg-[var(--surface)] px-5 py-4 sm:px-6">
          {isImporting ? (
            <div
              className="rounded-xl border px-3 py-3"
              style={{ borderColor: "color-mix(in srgb, var(--brand) 30%, transparent)", background: "var(--brand-soft)" }}
              role="status"
              aria-live="polite"
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-sm font-medium" style={{ color: "var(--brand-hover)" }}>
                <span>{dict.admin.uploadImporting}</span>
                {importProgress != null ? (
                  <span className="tabular-nums">{importProgress}%</span>
                ) : null}
              </div>
              {importCounts ? (
                <p className="mb-2 text-xs" style={{ color: "var(--brand-hover)" }}>
                  {t(dict.admin.uploadProgressCounts, {
                    done: importCounts.done,
                    total: importCounts.total,
                    remaining: Math.max(0, importCounts.total - importCounts.done),
                  })}
                </p>
              ) : null}
              <div className="h-2 overflow-hidden rounded-full" style={{ background: "color-mix(in srgb, var(--brand) 20%, transparent)" }}>
                <div
                  className={`h-full rounded-full ${
                    importProgress == null ? "w-1/3 animate-pulse" : "transition-[width] duration-300 ease-out"
                  }`}
                  style={{
                    background: "var(--brand)",
                    width: importProgress == null ? undefined : `${importProgress}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
          {failureResult ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary">
                {dict.common.close}
              </button>
              <button
                type="button"
                onClick={handleDownloadFailedRows}
                disabled={fileContent == null}
                className="btn btn-primary"
              >
                {dict.admin.uploadFailuresDownload}
              </button>
            </div>
          ) : confirmingSkip ? (
            <div className="banner-error space-y-2" role="alertdialog">
              <p className="font-medium">{dict.admin.uploadConfirmSkipTitle}</p>
              <p>{t(dict.admin.uploadConfirmSkipBody, { count: errorCount })}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingSkip(false)}
                  className="btn btn-secondary"
                >
                  {dict.common.cancel}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingSkip(false);
                    void handleImport();
                  }}
                  className="btn btn-danger"
                >
                  {dict.admin.uploadConfirmSkipProceed}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-secondary">
                {dict.common.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (errorCount > 0) {
                    setConfirmingSkip(true);
                    return;
                  }
                  void handleImport();
                }}
                disabled={!hasPreview || isImporting || isReading || !canImport}
                className="btn btn-primary"
              >
                {isImporting ? dict.admin.uploadImporting : dict.admin.uploadConfirm}
              </button>
            </div>
          )}
        </div>
      </div>
      {showErrorRows ? (
        <div className="absolute inset-0 z-20 flex items-end justify-center sm:items-center sm:p-6">
          <button
            type="button"
            aria-label={dict.common.close}
            className="absolute inset-0 bg-black/30"
            onClick={() => setShowErrorRows(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-upload-errors-title"
            className="surface-card relative z-10 flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl shadow-xl sm:rounded-2xl"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-4">
              <h3
                id="data-upload-errors-title"
                className="text-base font-semibold"
                style={{ color: "var(--danger)" }}
              >
                {t(dict.admin.uploadPreviewSummaryErrorPart, { error: errorCount })}
              </h3>
              <button
                type="button"
                onClick={() => setShowErrorRows(false)}
                aria-label={dict.common.close}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
              >
                <CloseIcon />
              </button>
            </div>
            <ul className="divide-y overflow-y-auto">
              {previewRows
                ?.filter((row) => row.action === "error")
                .map((row) => (
                  <li key={row.key} className="px-5 py-2.5 text-sm">
                    <p className="font-medium">{row.label}</p>
                    {row.detail ? (
                      <p
                        className="mt-0.5 whitespace-pre-wrap break-words text-xs"
                        style={{ color: "var(--danger)" }}
                      >
                        {row.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}

function ImportFailuresView({
  dict,
  result,
}: {
  dict: Dictionary;
  result: { failures: ImportFailure[]; succeeded: number };
}) {
  return (
    <div className="flex min-h-0 flex-col gap-3 px-5 py-4 sm:px-6">
      <div className="banner-error space-y-1" role="alert">
        <p className="font-semibold">{dict.admin.uploadFailuresTitle}</p>
        <p>
          {t(dict.admin.uploadFailuresSummary, {
            succeeded: result.succeeded,
            failed: result.failures.length,
          })}
        </p>
      </div>
      <p className="text-sm text-[var(--text-muted)]">
        {dict.admin.uploadFailuresHint}
      </p>
      <ul className="max-h-[50vh] divide-y overflow-y-auto rounded-xl border">
        {result.failures.map((failure) => (
          <li key={failure.rowNumber} className="px-3 py-2.5 text-sm">
            <p className="flex flex-wrap items-baseline gap-x-2 font-medium">
              <span className="tabular-nums">
                {t(dict.admin.uploadFailureRow, { row: failure.rowNumber })}
              </span>
              {failure.label ? (
                <span className="text-[var(--text-muted)]">{failure.label}</span>
              ) : null}
            </p>
            <p
              className="mt-0.5 whitespace-pre-wrap break-words text-xs"
              style={{ color: "var(--danger)" }}
            >
              {failure.error}
            </p>
          </li>
        ))}
      </ul>
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
