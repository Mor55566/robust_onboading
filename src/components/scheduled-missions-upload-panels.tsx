"use client";

import { useState } from "react";
import {
  importMissionHistoryAction,
  importScheduledMissionsAction,
  previewMissionHistoryImportAction,
} from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportFailure,
  type ImportPreviewRow,
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
  parseMissionsImportContent,
  type MissionImportRow,
} from "@/lib/mission-import";
import {
  buildMissionHistoryCsvTemplate,
  buildMissionHistoryExcelTemplate,
  parseMissionHistoryImportContent,
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
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [historyUploadOpen, setHistoryUploadOpen] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<{
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

  async function handleImport(rows: MissionImportRow[]) {
    setMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.flatMap((row) => row.buildings));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    const result = await importScheduledMissionsAction(complexId, rows);
    if (result.error) {
      return { error: result.error };
    }
    setMessage({
      type: "success",
      text:
        result.success ??
        t(dict.superAdmin.scheduledMissionsUploadSuccess, {
          count: rows.length,
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

  async function previewHistoryRows(
    rows: MissionHistoryImportRow[],
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
              row.status === "closed"
                ? dict.superAdmin.missionHistoryStatusDone
                : dict.superAdmin.missionHistoryStatusNotDone,
              checkCount > 0
                ? `${checkCount} ${dict.superAdmin.missionHistoryChecksLabel}`
                : null,
              row.classification === "create" && row.unmatchedTemplate
                ? t(dict.superAdmin.missionHistoryUnmatchedTitle, {
                    title: row.title,
                  })
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
  ) {
    setHistoryMessage(null);
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

    setHistoryMessage({
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
        csvFilename="scheduled-missions-template.csv"
        excelFilename="scheduled-missions-template.xls"
        buildCsv={buildMissionsCsvTemplate}
        buildExcel={buildMissionsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseMissionsImportContent(content, fileName);
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
        previewAsync={previewHistoryRows}
        onClose={() => setHistoryUploadOpen(false)}
        onImport={handleHistoryImport}
      />
    </div>
  );
}
