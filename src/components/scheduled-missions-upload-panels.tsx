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
} from "@/lib/mission-history-import";

export function ScheduledMissionsUploadPanels({ dict }: { dict: Dictionary }) {
  const {
    complexId,
    checkBuildingNames,
    checkMissionTemplateTitles,
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
        key: `mission-${row.externalId}`,
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
    const result = await importScheduledMissionsAction(rows);
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

  function checkMissionHistoryRows(rows: MissionHistoryImportRow[]): string[] {
    return [
      ...checkMissionTemplateTitles(rows.map((row) => row.title)),
      ...checkBuildingNames(rows.flatMap((row) => row.buildingsRaw)),
    ];
  }

  async function previewHistoryRows(
    rows: MissionHistoryImportRow[],
  ): Promise<ImportPreviewRow[] | { error: string }> {
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkMissionHistoryRows(rows);
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    const result = await previewMissionHistoryImportAction(rows);
    if ("error" in result) return result;
    return result.rows.map((row) => {
      const detail =
        row.classification === "skip"
          ? row.skipReason === "externalIdConflict"
            ? t(dict.superAdmin.missionHistoryExternalIdConflict, {
                id: row.externalId,
              })
            : t(dict.superAdmin.missionHistoryUnmatchedTitle, {
                title: row.title,
              })
          : [
              row.status === "closed"
                ? dict.superAdmin.missionHistoryStatusDone
                : dict.superAdmin.missionHistoryStatusNotDone,
              row.checklistItems.length > 0
                ? `${row.checklistItems.length} ${dict.superAdmin.missionHistoryChecksLabel}`
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

    for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
      const batch = rows.slice(offset, offset + BATCH_SIZE);
      const result = await importMissionHistoryAction(batch);
      if (result.error) {
        return { error: result.error };
      }
      created += result.created ?? 0;
      updated += result.updated ?? 0;
      skipped += result.skipped ?? 0;

      done = Math.min(offset + batch.length, total);
      reportProgress((done / total) * 100, { done, total });
    }

    setHistoryMessage({
      type: "success",
      text: t(dict.superAdmin.missionHistoryUploadSuccess, {
        created,
        updated,
        skipped,
      }),
    });
    void refreshUploadStatus();
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
