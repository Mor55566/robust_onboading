"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteMissionsAction,
  getDeletableMissionsAction,
  type DeletableMission,
  importMissionHistoryAction,
  importScheduledMissionsAction,
  previewMissionHistoryImportAction,
} from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportFailure,
  type ImportPreviewRow,
  type ImportProgressCounts,
} from "@/components/data-upload-modal";
import { ScheduledMissionsImportGuideModal } from "@/components/scheduled-missions-import-guide-modal";
import { UploadCard, UploadMessage } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  formatGuardBlockError,
  GUARD_NOT_READY_MESSAGE,
} from "@/lib/complex-guard";
import {
  buildMissionsCsvTemplate,
  buildMissionsExcelTemplate,
  MISSING_LOCATION_ORDER_PREFIX,
  MISSING_NEXT_RUN_PREFIX,
  parseMissionsImportContent,
  type MissionImportRow,
} from "@/lib/mission-import";
import {
  buildMissionHistoryCsvTemplate,
  buildMissionHistoryExcelTemplate,
  buildOpenMissionsCsvTemplate,
  buildOpenMissionsExcelTemplate,
  parseMissionHistoryImportContent,
  parseOpenMissionsImportContent,
  type MissionHistoryImportRow,
  type ResolvedMissionHistoryImportRow,
} from "@/lib/mission-history-import";

export function ScheduledMissionsUploadPanels({ dict }: { dict: Dictionary }) {
  const {
    complexId,
    checkBuildingNames,
    guardDirectoryReady,
    uploadStatus,
    refreshUploadStatus,
  } = useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pauseAll, setPauseAll] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [historyUploadOpen, setHistoryUploadOpen] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteMessage, setDeleteMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [openUploadOpen, setOpenUploadOpen] = useState(false);
  const [openMessage, setOpenMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function previewRows(rows: MissionImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => {
      const bits = [
        row.externalId ? `id: ${row.externalId}` : null,
        row.frequency || null,
        row.buildings.length > 0 ? row.buildings.join(", ") : null,
        row.locations.length > 0 ? `${row.locations.length} locations` : null,
      ].filter(Boolean);
      return {
        key: `mission-${row.rowNumber}`,
        label: row.title.slice(0, 80) || `Row ${row.rowNumber}`,
        detail: bits.join(" · ") || undefined,
        action: "create" as const,
      };
    });
  }

  async function handleImport(
    rows: MissionImportRow[],
    reportProgress: (percent: number, counts?: ImportProgressCounts) => void,
  ) {
    setMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.flatMap((row) => row.buildings));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    reportProgress(0);

    // Sent in sequential batches: hosts cap server-action bodies (Vercel
    // ~4.5MB) and function duration, and a full export with checklists
    // exceeds both in one request.
    const MAX_BATCH_ROWS = 25;
    const MAX_BATCH_BYTES = 2_000_000;
    // Rows without an external id are matched to existing missions by title
    // on the server, so same-title rows must share a batch — otherwise a later
    // batch would update a mission an earlier batch just created.
    const groups = new Map<string, MissionImportRow[]>();
    for (const row of rows) {
      const key = row.externalId.trim()
        ? `id:${row.externalId.trim()}`
        : `title:${row.title.trim().toLowerCase().replace(/\s+/g, " ")}`;
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    const batches: MissionImportRow[][] = [];
    let current: MissionImportRow[] = [];
    let currentBytes = 0;
    for (const group of groups.values()) {
      const groupBytes = JSON.stringify(group).length;
      if (
        current.length > 0 &&
        (current.length + group.length > MAX_BATCH_ROWS ||
          currentBytes + groupBytes > MAX_BATCH_BYTES)
      ) {
        batches.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(...group);
      currentBytes += groupBytes;
    }
    if (current.length > 0) batches.push(current);

    let created = 0;
    let updated = 0;
    let doneRows = 0;
    for (const batch of batches) {
      let result: Awaited<ReturnType<typeof importScheduledMissionsAction>>;
      try {
        result = await importScheduledMissionsAction(complexId, batch, {
          pauseAll,
        });
      } catch (error) {
        console.error("Scheduled missions import batch failed", error);
        result = {
          error:
            error instanceof Error && error.message
              ? `${dict.admin.uploadImportFailed} (${error.message})`
              : dict.admin.uploadImportFailed,
        };
      }
      created += result.created ?? 0;
      updated += result.updated ?? 0;
      if (result.error) {
        if (created + updated > 0) void refreshUploadStatus();
        const progressNote =
          created + updated > 0
            ? ` (${t(dict.superAdmin.scheduledMissionsUploadSuccessDetailed, {
                created,
                updated,
              })})`
            : "";
        return { error: `${result.error}${progressNote}` };
      }
      doneRows += batch.length;
      reportProgress((doneRows / rows.length) * 100, {
        done: doneRows,
        total: rows.length,
      });
    }

    setMessage({
      type: "success",
      text:
        updated > 0
          ? t(dict.superAdmin.scheduledMissionsUploadSuccessDetailed, {
              created,
              updated,
            })
          : t(dict.superAdmin.scheduledMissionsUploadSuccess, {
              count: created,
            }),
    });
    void refreshUploadStatus();
  }

  // Titles aren't guarded: the same task title (e.g. a routine pump check)
  // legitimately exists in many complexes, and the server only matches titles
  // against the selected complex's scheduled missions anyway.
  function checkMissionHistoryRows(rows: MissionHistoryImportRow[]): string[] {
    return checkBuildingNames(rows.flatMap((row) => row.buildingsRaw));
  }

  // Shared by the history and open-missions uploads: both are mission
  // occurrences imported through the same server actions.
  async function previewHistoryRows(
    rows: MissionHistoryImportRow[],
    kind: "history" | "open" = "history",
  ): Promise<ImportPreviewRow[] | { error: string }> {
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkMissionHistoryRows(rows);
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    // Checklist items are most of the payload (a year's export is ~15MB) and the
    // preview only needs their count — plus one item per location, which the
    // server uses to place rows that have no scheduled mission.
    const checksByExternalId = new Map(
      rows.map((row) => [row.externalId, row.checklistItems.length]),
    );
    const slimRows = rows.map((row) => ({
      ...row,
      checklistItems: row.checklistItems.filter(
        (item, index, items) =>
          items.findIndex((other) => other.location === item.location) === index,
      ),
    }));
    // Sent in batches: hosts cap server-action bodies (Vercel ~4.5MB) and a
    // full export still exceeds that even when slimmed.
    const PREVIEW_BATCH_SIZE = 50;
    const resolvedRows: ResolvedMissionHistoryImportRow[] = [];
    for (let offset = 0; offset < slimRows.length; offset += PREVIEW_BATCH_SIZE) {
      const result = await previewMissionHistoryImportAction(
        complexId,
        slimRows.slice(offset, offset + PREVIEW_BATCH_SIZE),
      );
      if ("error" in result) return result;
      resolvedRows.push(...result.rows);
    }
    return resolvedRows.map((row) => {
      const checkCount = checksByExternalId.get(row.externalId) ?? 0;
      const detail =
        row.classification === "skip"
          ? row.skipReason === "externalIdConflict"
            ? t(dict.superAdmin.missionHistoryExternalIdConflict, {
                id: row.externalId,
              })
            : t(dict.superAdmin.missionHistoryNoBuilding, {
                title: row.title,
              })
          : [
              kind === "open"
                ? dict.superAdmin.openMissionsStatusOpen
                : row.status === "closed"
                  ? dict.superAdmin.missionHistoryStatusDone
                  : dict.superAdmin.missionHistoryStatusNotDone,
              kind === "open" ? row.assignedUserRaw || null : null,
              checkCount > 0
                ? `${checkCount} ${dict.superAdmin.missionHistoryChecksLabel}`
                : null,
              row.classification === "create" && row.unmatchedTemplate
                ? t(
                    kind === "open"
                      ? dict.superAdmin.openMissionsUnmatchedTitle
                      : dict.superAdmin.missionHistoryUnmatchedTitle,
                    { title: row.title },
                  )
                : null,
            ]
              .filter(Boolean)
              .join(" · ");
    return {
        key: `mission-history-${row.externalId}`,
        label: row.title.slice(0, 80) || `Row ${row.rowNumber}`,
        detail: detail || undefined,
        action: row.classification,
      };
    });
  }

  async function handleHistoryImport(
    rows: MissionHistoryImportRow[],
    reportProgress: (
      percent: number,
      counts?: { done: number; total: number },
    ) => void,
    setResultMessage: typeof setHistoryMessage = setHistoryMessage,
  ) {
    setResultMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkMissionHistoryRows(rows);
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    const total = rows.length;
    reportProgress(0, { done: 0, total });

    const BATCH_SIZE = 10;
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let done = 0;
    const failures: ImportFailure[] = [];

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const result = await importMissionHistoryAction(complexId, batch);
      created += result.created ?? 0;
      updated += result.updated ?? 0;
      skipped += result.skipped ?? 0;
      failures.push(...(result.failures ?? []));
      if (result.error) {
        // The whole batch stopped (e.g. the database dropped): name its rows
        // so it's clear where the import got to.
        const range = t(dict.admin.uploadFailureRow, {
          row: `${batch[0]!.rowNumber}–${batch[batch.length - 1]!.rowNumber}`,
        });
        if (failures.length === 0 && created + updated === 0) {
          return { error: `${range}: ${result.error}` };
        }
        failures.push({ rowNumber: batch[0]!.rowNumber, label: range, error: result.error });
        break;
      }

      done = Math.min(offset + batch.length, total);
      reportProgress((done / total) * 100, { done, total });
    }

    void refreshUploadStatus();
    if (failures.length > 0) {
      failures.sort((a, b) => a.rowNumber - b.rowNumber);
      return { failures, succeeded: created + updated };
    }

    setResultMessage({
      type: "success",
      text: t(dict.superAdmin.missionHistoryUploadSuccess, {
        created,
        updated,
        skipped,
      }),
    });
  }

  return (
    <div className="space-y-4">
      <UploadMessage message={message} />

      <UploadCard
        title={dict.superAdmin.scheduledMissionsUploadTitle}
        subtitle={dict.superAdmin.scheduledMissionsUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.scheduledMissions : undefined}
        guideLabel={dict.superAdmin.scheduledMissionsImportGuideButton}
        onGuide={() => setGuideOpen(true)}
      />

      <DataUploadModal
        open={uploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.scheduledMissionsUploadTitle,
          subtitle: dict.superAdmin.scheduledMissionsUploadSubtitle,
          empty: dict.superAdmin.scheduledMissionsUploadEmpty,
          invalid: dict.superAdmin.scheduledMissionsUploadInvalid,
          invalidRow: dict.superAdmin.scheduledMissionsUploadInvalidRow,
          missingDescription:
            dict.superAdmin.scheduledMissionsUploadMissingRequired,
        }}
        extraFields={
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-muted)]">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded"
              checked={pauseAll}
              onChange={(event) => setPauseAll(event.target.checked)}
            />
            <span className="space-y-0.5">
              <span className="block text-sm font-medium">
                {dict.superAdmin.scheduledMissionsUploadPauseAll}
              </span>
              <span className="block text-xs text-[var(--text-muted)]">
                {dict.superAdmin.scheduledMissionsUploadPauseAllHint}
              </span>
            </span>
          </label>
        }
        csvFilename="scheduled-missions-template.csv"
        excelFilename="scheduled-missions-template.xls"
        buildCsv={buildMissionsCsvTemplate}
        buildExcel={buildMissionsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseMissionsImportContent(content, fileName);
          if (
            "error" in parsed &&
            parsed.message?.startsWith(MISSING_LOCATION_ORDER_PREFIX)
          ) {
            return {
              error: parsed.error,
              message: t(dict.superAdmin.scheduledMissionsUploadMissingLocationOrder, {
                missions: parsed.message.slice(MISSING_LOCATION_ORDER_PREFIX.length),
              }),
            };
          }
          if (
            "error" in parsed &&
            parsed.message?.startsWith(MISSING_NEXT_RUN_PREFIX)
          ) {
            return {
              error: parsed.error,
              message: t(dict.superAdmin.scheduledMissionsUploadMissingNextRun, {
                missions: parsed.message.slice(MISSING_NEXT_RUN_PREFIX.length),
              }),
            };
          }
          if (
            "error" in parsed &&
            parsed.message === "__missing_required__"
          ) {
            return {
              error: parsed.error,
              message: dict.superAdmin.scheduledMissionsUploadMissingRequired,
            };
          }
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.scheduledMissionsUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        preview={previewRows}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />

      <ScheduledMissionsImportGuideModal
        open={guideOpen}
        dict={dict}
        onClose={() => setGuideOpen(false)}
      />

      <UploadMessage message={historyMessage} />

      <UploadCard
        title={dict.superAdmin.missionHistoryUploadTitle}
        subtitle={dict.superAdmin.missionHistoryUploadSubtitle}
        buttonLabel={dict.superAdmin.missionHistoryUploadButton}
        onOpen={() => setHistoryUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.missionHistory : undefined}
      />

      <DataUploadModal
        open={historyUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.missionHistoryUploadTitle,
          subtitle: dict.superAdmin.missionHistoryUploadSubtitle,
          empty: dict.superAdmin.missionHistoryUploadEmpty,
          invalid: dict.superAdmin.missionHistoryUploadInvalid,
          invalidRow: dict.superAdmin.missionHistoryUploadInvalidRow,
          missingDescription: dict.superAdmin.missionHistoryUploadMissingRequired,
        }}
        csvFilename="mission-history-template.csv"
        excelFilename="mission-history-template.xls"
        buildCsv={buildMissionHistoryCsvTemplate}
        buildExcel={buildMissionHistoryExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseMissionHistoryImportContent(content, fileName);
          if (
            "error" in parsed &&
            parsed.message === "__missing_required__"
          ) {
            return {
              error: parsed.error,
              message: dict.superAdmin.missionHistoryUploadMissingRequired,
            };
          }
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.missionHistoryUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        previewAsync={(rows) => previewHistoryRows(rows)}
        onClose={() => setHistoryUploadOpen(false)}
        onImport={(rows, reportProgress) =>
          handleHistoryImport(rows, reportProgress)
        }
      />

      <UploadMessage message={openMessage} />

      <UploadCard
        title={dict.superAdmin.openMissionsUploadTitle}
        subtitle={dict.superAdmin.openMissionsUploadSubtitle}
        buttonLabel={dict.superAdmin.openMissionsUploadButton}
        onOpen={() => setOpenUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.openMissions : undefined}
      />

      <DataUploadModal
        open={openUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.openMissionsUploadTitle,
          subtitle: dict.superAdmin.openMissionsUploadSubtitle,
          empty: dict.superAdmin.openMissionsUploadEmpty,
          invalid: dict.superAdmin.missionHistoryUploadInvalid,
          invalidRow: dict.superAdmin.openMissionsUploadInvalidRow,
          missingDescription: dict.superAdmin.openMissionsUploadMissingRequired,
        }}
        csvFilename="open-missions-template.csv"
        excelFilename="open-missions-template.xls"
        buildCsv={buildOpenMissionsCsvTemplate}
        buildExcel={buildOpenMissionsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseOpenMissionsImportContent(content, fileName);
          if (
            "error" in parsed &&
            parsed.message === "__missing_required__"
          ) {
            return {
              error: parsed.error,
              message: dict.superAdmin.openMissionsUploadMissingRequired,
            };
          }
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.openMissionsUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        previewAsync={(rows) => previewHistoryRows(rows, "open")}
        onClose={() => setOpenUploadOpen(false)}
        onImport={(rows, reportProgress) =>
          handleHistoryImport(rows, reportProgress, setOpenMessage)
        }
      />

      <UploadMessage message={deleteMessage} />

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold">
              {dict.superAdmin.deleteMissionsTitle}
            </h2>
            <p className="text-sm text-[var(--text-muted)]">
              {dict.superAdmin.deleteMissionsHint}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-danger shrink-0"
            disabled={!complexId}
            onClick={() => {
              setDeleteMessage(null);
              setDeleteOpen(true);
            }}
          >
            {dict.superAdmin.deleteMissions}
          </button>
        </div>
      </section>

      <DeleteMissionsModal
        open={deleteOpen && !!complexId}
        complexId={complexId}
        dict={dict}
        onClose={() => setDeleteOpen(false)}
        onDeleted={(text) => {
          setDeleteOpen(false);
          setDeleteMessage({ type: "success", text });
          void refreshUploadStatus();
        }}
      />
    </div>
  );
}

function plainMissionName(value: string) {
  const element = typeof document === "undefined" ? null : document.createElement("div");
  if (!element) return value;
  element.innerHTML = value;
  return element.textContent?.trim() || value;
}

function DeleteMissionsModal({
  open,
  complexId,
  dict,
  onClose,
  onDeleted,
}: {
  open: boolean;
  complexId: string | null;
  dict: Dictionary;
  onClose: () => void;
  onDeleted: (message: string) => void;
}) {
  const [missions, setMissions] = useState<DeletableMission[]>([]);
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
        return getDeletableMissionsAction(complexId ?? "");
      })
      .then((result) => {
        if (!active || !result) return;
        if (result.error) setError(result.error);
        setMissions(result.missions ?? []);
      })
      .catch(() => {
        if (active) setError(dict.superAdmin.deleteMissionsFailed);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, complexId, dict.superAdmin.deleteMissionsFailed]);

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
    missions.length > 0 && missions.every((mission) => selected.has(mission.id));

  function toggleSelectAll() {
    setConfirming(false);
    setError(null);
    setSelected(
      allSelected ? new Set() : new Set(missions.map((mission) => mission.id)),
    );
  }

  async function handleDelete() {
    if (selected.size === 0) {
      setError(dict.superAdmin.deleteMissionsNoneSelected);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      const result = await deleteMissionsAction(complexId ?? "", [...selected]);
      if (result.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      onDeleted(
        result.success ??
          t(dict.superAdmin.deleteMissionsSuccess, {
            count: result.deleted ?? selected.size,
          }),
      );
    } catch {
      setError(dict.superAdmin.deleteMissionsFailed);
      setConfirming(false);
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
        aria-labelledby="delete-missions-title"
        className="surface-card relative z-10 flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-2xl"
      >
        <div className="shrink-0 border-b bg-[var(--surface)] px-5 py-5 sm:px-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="delete-missions-title" className="text-lg font-semibold">
                {dict.superAdmin.deleteMissionsTitle}
              </h2>
              <p className="mt-1 text-sm text-[var(--text-muted)]">
                {dict.superAdmin.deleteMissionsSubtitle}
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
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              {dict.superAdmin.deleteMissionsLoading}
            </p>
          ) : missions.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              {dict.superAdmin.deleteMissionsEmpty}
            </p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border bg-[var(--surface-muted)] px-4 py-2.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">
                  {t(dict.superAdmin.deleteTicketsSelected, { count: selected.size })}
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
                {missions.map((mission) => (
                  <label
                    key={mission.id}
                    className="flex cursor-pointer items-start gap-3 rounded-xl border bg-[var(--surface)] px-4 py-3 hover:bg-[var(--surface-muted)]"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 rounded accent-[var(--danger)]"
                      checked={selected.has(mission.id)}
                      disabled={deleting}
                      onChange={(event) => {
                        setConfirming(false);
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(mission.id);
                          else next.delete(mission.id);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 break-words text-sm font-medium">
                      {plainMissionName(mission.name)}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t bg-[var(--surface)] px-5 py-4 sm:px-6">
          {error ? <p className="mb-3 banner-error" role="alert">{error}</p> : null}
          {confirming ? (
            <div className="space-y-3">
              <p className="text-sm font-medium leading-relaxed text-[var(--danger)]" role="alert">
                {t(dict.superAdmin.deleteMissionsAreYouSure, { count: selected.size })}
              </p>
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
                  {deleting
                    ? dict.superAdmin.deleteTicketsDeleting
                    : dict.superAdmin.deleteMissionsYesDelete}
                </button>
              </div>
            </div>
          ) : (
            <>
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
                  {dict.superAdmin.deleteMissionsConfirm}
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
