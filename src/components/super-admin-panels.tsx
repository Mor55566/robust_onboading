"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteTicketsAction,
  getDeletableTicketsAction,
  importAutomationsAction,
  importTasksAction,
  type DeletableTicket,
} from "@/app/actions/super-admin";
import { CategoriesUploadPanels } from "@/components/categories-upload-panels";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import { UploadCard, UploadMessage } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  formatGuardBlockError,
  GUARD_NOT_READY_MESSAGE,
} from "@/lib/complex-guard";
import {
  buildTasksCsvTemplate,
  buildTasksExcelTemplate,
  parseTasksImportContent,
  type TaskImportRow,
} from "@/lib/task-import";
import {
  buildAutomationsCsvTemplate,
  buildAutomationsExcelTemplate,
  parseAutomationsImportContent,
  type AutomationImportRow,
} from "@/lib/automation-import";

export function SuperAdminPanels({ dict }: { dict: Dictionary }) {
  const { complexId, checkBuildingNames, guardDirectoryReady, uploadStatus, refreshUploadStatus } =
    useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [automationsUploadOpen, setAutomationsUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function previewRows(rows: TaskImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => {
      const bits = [
        row.callNumber ? `#${row.callNumber}` : null,
        row.building || null,
        row.status,
        row.urgency,
      ].filter(Boolean);
      return {
        key: `task-${row.rowNumber}`,
        label: row.description.slice(0, 80) || `Row ${row.rowNumber}`,
        detail: bits.join(" · ") || undefined,
        action: "create" as const,
      };
    });
  }

  async function handleImport(
    rows: TaskImportRow[],
    reportProgress: (percent: number) => void,
  ) {
    setMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.map((row) => row.building));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    reportProgress(0);

    const BATCH_SIZE = 20;
    let created = 0;
    let updated = 0;

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const result = await importTasksAction(batch);
      created += result.created ?? 0;
      updated += result.updated ?? 0;

      if (result.error) {
        return { error: result.error };
      }

      reportProgress(
        (Math.min(offset + batch.length, rows.length) / rows.length) * 100,
      );
    }

    const success =
      updated > 0
        ? t(dict.superAdmin.uploadSuccessDetailed, { created, updated })
        : t(dict.superAdmin.uploadSuccess, { count: created });
    setMessage({
      type: "success",
      text: success,
    });
    void refreshUploadStatus();
  }

  function previewAutomationRows(rows: AutomationImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `automation-${row.rowNumber}`,
      label: `${row.rulePreview} ← ${row.actionPreview}`,
      detail: row.incompleteReason || [row.buildingNames.join(", "), row.categoryNames.join(", "), row.subcategoryNames.join(", ")].filter(Boolean).join(" · "),
      action: "create" as const,
    }));
  }

  async function handleAutomationsImport(rows: AutomationImportRow[]) {
    setMessage(null);
    if (!complexId) return { error: dict.admin.complexNotFound };
    const result = await importAutomationsAction(complexId, rows);
    if (result.error) return { error: result.error };
    setMessage({
      type: "success",
      text: t(dict.superAdmin.automationsUploadSuccess, {
        created: result.created ?? 0,
        updated: result.updated ?? 0,
      }),
    });
    void refreshUploadStatus();
  }

  return (
    <div className="space-y-4">
      <UploadMessage message={message} />

      <CategoriesUploadPanels dict={dict} stepNumber={1} />

      <UploadCard
        title={dict.superAdmin.uploadTitle}
        subtitle={dict.superAdmin.uploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.tasks : undefined}
        stepNumber={2}
      />

      <UploadCard
        title={dict.superAdmin.automationsUploadTitle}
        subtitle={dict.superAdmin.automationsUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setAutomationsUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.automations : undefined}
        stepNumber={3}
      />

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold">
              {dict.superAdmin.deleteTicketsTitle}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {dict.superAdmin.deleteTicketsCloudinaryHint}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger shrink-0"
            onClick={() => setDeleteOpen(true)}
          >
            {dict.superAdmin.deleteTickets}
          </button>
        </div>
      </section>

      <DataUploadModal
        open={uploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.uploadTitle,
          subtitle: dict.superAdmin.uploadSubtitle,
          empty: dict.superAdmin.uploadEmpty,
          invalid: dict.superAdmin.uploadInvalid,
          invalidRow: dict.superAdmin.uploadInvalidRow,
          missingDescription: dict.superAdmin.uploadMissingDescription,
        }}
        csvFilename="tasks-template.csv"
        excelFilename="tasks-template.xls"
        buildCsv={buildTasksCsvTemplate}
        buildExcel={buildTasksExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseTasksImportContent(content, fileName);
          if ("error" in parsed && parsed.message === "__missing_description__") {
            return {
              error: parsed.error,
              message: dict.superAdmin.uploadMissingDescription,
            };
          }
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.uploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        preview={previewRows}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />
      <DataUploadModal
        open={automationsUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.automationsUploadTitle,
          subtitle: dict.superAdmin.automationsUploadSubtitle,
          empty: dict.superAdmin.automationsUploadEmpty,
          invalid: dict.superAdmin.automationsUploadInvalid,
          invalidRow: dict.superAdmin.automationsUploadInvalidRow,
        }}
        csvFilename="automations-template.csv"
        excelFilename="automations-template.xls"
        buildCsv={buildAutomationsCsvTemplate}
        buildExcel={buildAutomationsExcelTemplate}
        parse={parseAutomationsImportContent}
        preview={previewAutomationRows}
        onClose={() => setAutomationsUploadOpen(false)}
        onImport={handleAutomationsImport}
      />
      <DeleteTicketsModal
        open={deleteOpen}
        dict={dict}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(text) => {
          setDeleteOpen(false);
          setMessage({ type: "success", text });
        }}
      />
    </div>
  );
}

function plainTicketName(value: string) {
  const element = typeof document === "undefined" ? null : document.createElement("div");
  if (!element) return value;
  element.innerHTML = value;
  return element.textContent?.trim() || value;
}

function DeleteTicketsModal({
  open,
  dict,
  onClose,
  onDeleted,
}: {
  open: boolean;
  dict: Dictionary;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [tickets, setTickets] = useState<DeletableTicket[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.resolve()
      .then(() => {
        if (!active) return null;
        setLoading(true);
        setError(null);
        setSelected(new Set());
        setConfirming(false);
        return getDeletableTicketsAction();
      })
      .then((result) => {
        if (!active || !result) return;
        if (result.error) setError(result.error);
        setTickets(result.tickets ?? []);
      })
      .catch(() => {
        if (active) setError(dict.superAdmin.deleteTicketsFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, dict.superAdmin.deleteTicketsFailed]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !deleting) {
        if (confirming) setConfirming(false);
        else onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, deleting, confirming, onClose]);

  if (!open || typeof document === "undefined") return null;

  const allSelected =
    tickets.length > 0 && tickets.every((ticket) => selected.has(ticket.id));

  function toggleSelectAll() {
    setConfirming(false);
    setError(null);
    setSelected(
      allSelected ? new Set() : new Set(tickets.map((ticket) => ticket.id)),
    );
  }

  async function handleDelete() {
    if (selected.size === 0) {
      setError(dict.superAdmin.deleteTicketsNoneSelected);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteTicketsAction([...selected]);
      if (result.error) {
        setError(result.error);
        return;
      }
      onDeleted(
        result.success ??
          t(dict.superAdmin.deleteTicketsSuccess, { count: result.deleted ?? selected.size }),
      );
    } catch {
      setError(dict.superAdmin.deleteTicketsFailed);
    } finally {
      setDeleting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        aria-label={dict.common.close}
        className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
        onClick={deleting ? undefined : onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-tickets-title"
        className="surface-card relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl"
      >
        <div className="shrink-0 border-b bg-[var(--surface)] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="delete-tickets-title" className="text-lg font-semibold">
                {dict.superAdmin.deleteTicketsTitle}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {dict.superAdmin.deleteTicketsSubtitle}
              </p>
            </div>
            <button
              type="button"
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--text-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--text)]"
              onClick={onClose}
              disabled={deleting}
              aria-label={dict.common.close}
            >
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          {loading ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">{dict.superAdmin.deleteTicketsLoading}</p>
          ) : tickets.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">{dict.superAdmin.deleteTicketsEmpty}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-[var(--surface-muted)] px-4 py-2.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  {t(dict.superAdmin.deleteTicketsSelected, {
                    count: selected.size,
                  })}
                </span>
                <button
                  type="button"
                  className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={deleting}
                  onClick={toggleSelectAll}
                >
                  {allSelected
                    ? dict.superAdmin.deleteTicketsClearAll
                    : dict.superAdmin.deleteTicketsSelectAll}
                </button>
              </div>
              <div className="space-y-2">
                {tickets.map((ticket) => (
                  <label key={ticket.id} className="flex cursor-pointer items-start gap-3 rounded-xl border bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-muted)]">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded accent-[var(--danger)]"
                      checked={selected.has(ticket.id)}
                      disabled={deleting}
                      onChange={(event) => {
                        setConfirming(false);
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(ticket.id);
                          else next.delete(ticket.id);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 break-words text-sm font-medium">
                      {plainTicketName(ticket.name)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {error ? <p className="mt-3 banner-error" role="alert">{error}</p> : null}
        </div>

        <div className="shrink-0 border-t bg-[var(--surface)] px-5 py-4 sm:px-6">
          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm font-medium leading-relaxed text-[var(--danger)]" role="alert">
                {t(dict.superAdmin.deleteTicketsAreYouSure, { count: selected.size })}
              </p>
              <p className="text-xs text-[var(--text-muted)]">{dict.superAdmin.deleteTicketsCloudinaryHint}</p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={deleting}
                  onClick={() => setConfirming(false)}
                >
                  {dict.common.cancel}
                </button>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={deleting}
                  onClick={() => void handleDelete()}
                >
                  {deleting ? dict.superAdmin.deleteTicketsDeleting : dict.superAdmin.deleteTicketsYesDelete}
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="mb-3 text-xs text-[var(--text-muted)]">{dict.superAdmin.deleteTicketsCloudinaryHint}</p>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-[var(--text-muted)]">
                  {t(dict.superAdmin.deleteTicketsSelected, { count: selected.size })}
                </span>
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={selected.size === 0 || loading}
                  onClick={() => {
                    setError(null);
                    setConfirming(true);
                  }}
                >
                  {dict.superAdmin.deleteTicketsConfirm}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
