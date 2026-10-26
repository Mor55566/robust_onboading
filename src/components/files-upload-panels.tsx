"use client";

import { useState } from "react";
import {
  importFileAttachmentsAction,
  importFileTagsAction,
  importFilesAction,
  previewFileAttachmentsImportAction,
  previewFileTagsImportAction,
  validateFilesImportAction,
} from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportFailure,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import { DevtoolsScriptGuideModal } from "@/components/devtools-script-guide-modal";
import { UploadCard, UploadMessage } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import { DOCUMENT_FILES_EXPORT_SCRIPT } from "@/lib/document-files-export-script";
import { DOCUMENT_TAGS_EXPORT_SCRIPT } from "@/lib/document-tags-export-script";
import {
  buildFileAttachmentsCsvTemplate,
  buildFileAttachmentsExcelTemplate,
  buildFileTagsCsvTemplate,
  buildFileTagsExcelTemplate,
  buildFilesCsvTemplate,
  buildFilesExcelTemplate,
  parseFileAttachmentNotCloudinaryMessage,
  parseFileAttachmentsImportContent,
  parseFileTagsImportContent,
  parseFilesImportContent,
  type FileAttachmentImportDocument,
  type FileImportRow,
  type FileTagImportRow,
} from "@/lib/file-import";

type BatchResult = {
  error?: string;
  created?: number;
  updated?: number;
  failures?: ImportFailure[];
};

/**
 * Imports rows batch by batch without stopping at a failure: a batch that
 * fails as a whole is retried one row at a time, so only the rows that really
 * fail end up in the failures list (shown in red with a CSV of just them).
 */
async function importInBatches<Row extends { rowNumber: number }>(
  rows: Row[],
  batchSize: number,
  importBatch: (batch: Row[]) => Promise<BatchResult>,
  describeRow: (row: Row) => Omit<ImportFailure, "error">,
  /** Shown for a row when the server action itself throws. */
  fallbackError: string,
  reportProgress: (
    percent: number,
    counts?: { done: number; total: number },
  ) => void,
) {
  const total = rows.length;
  reportProgress(0, { done: 0, total });
  let created = 0;
  let updated = 0;
  const failures: ImportFailure[] = [];

  function add(result: BatchResult) {
    created += result.created ?? 0;
    updated += result.updated ?? 0;
    failures.push(...(result.failures ?? []));
  }

  for (let offset = 0; offset < rows.length; offset += batchSize) {
    const batch = rows.slice(offset, offset + batchSize);
    const result = await importBatch(batch).catch(
      (): BatchResult => ({ error: fallbackError }),
    );
    if (result.error === undefined) {
      add(result);
    } else if (batch.length === 1) {
      failures.push({ ...describeRow(batch[0]!), error: result.error });
    } else {
      for (const row of batch) {
        const single = await importBatch([row]).catch(
          (): BatchResult => ({ error: fallbackError }),
        );
        if (single.error === undefined) add(single);
        else failures.push({ ...describeRow(row), error: single.error });
      }
    }
    const done = Math.min(offset + batch.length, total);
    reportProgress((done / total) * 100, { done, total });
  }

  failures.sort((a, b) => a.rowNumber - b.rowNumber);
  return { created, updated, failures };
}

export function FilesUploadPanels({ dict }: { dict: Dictionary }) {
  const { complexId, uploadStatus, refreshUploadStatus } = useComplexContext();
  const [tagsUploadOpen, setTagsUploadOpen] = useState(false);
  const [tagsGuideOpen, setTagsGuideOpen] = useState(false);
  const [filesUploadOpen, setFilesUploadOpen] = useState(false);
  const [attachmentsUploadOpen, setAttachmentsUploadOpen] = useState(false);
  const [attachmentsGuideOpen, setAttachmentsGuideOpen] = useState(false);
  const [tagsMessage, setTagsMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [filesMessage, setFilesMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [attachmentsMessage, setAttachmentsMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  async function previewTagRows(
    rows: FileTagImportRow[],
  ): Promise<ImportPreviewRow[] | { error: string }> {
    const result = await previewFileTagsImportAction(complexId, rows);
    if (result.error || !result.items) {
      return { error: result.error ?? dict.superAdmin.fileTagsUploadFailed };
    }
    return result.items.map((item) => ({
      key: `tag-${item.rowNumber}-${item.name}`,
      label: item.name,
      detail:
        item.action === "skip"
          ? dict.superAdmin.fileTagsPreviewDuplicate
          : item.action === "update"
            ? t(dict.superAdmin.fileTagsPreviewColorUpdate, {
                from: item.previousColor ?? "—",
                to: item.color,
              })
            : item.color,
      action: item.action,
    }));
  }

  function previewFileRows(rows: FileImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `file-${row.externalId}`,
      label: row.title,
      detail: [
        `id: ${row.externalId}`,
        row.complex,
        row.tag || null,
        row.resident || null,
      ]
        .filter(Boolean)
        .join(" · "),
      action: "create" as const,
    }));
  }

  async function previewFileRowsAsync(
    rows: FileImportRow[],
  ): Promise<ImportPreviewRow[] | { error: string }> {
    const result = await validateFilesImportAction(complexId, rows);
    if (result.error) {
      return { error: result.error };
    }
    const failed = new Map(
      (result.failures ?? []).map((failure) => [failure.rowNumber, failure.error]),
    );
    return rows.map((row, index) => {
      const preview = previewFileRows([row])[0]!;
      const error = failed.get(row.rowNumber);
      return error
        ? { ...preview, key: `${preview.key}-${index}`, detail: error, action: "error" as const }
        : { ...preview, key: `${preview.key}-${index}` };
    });
  }

  async function handleTagsImport(rows: FileTagImportRow[]) {
    setTagsMessage(null);
    const result = await importFileTagsAction(complexId, rows);
    if (result.error) {
      return { error: result.error };
    }
    setTagsMessage({
      type: "success",
      text:
        result.success ??
        t(dict.superAdmin.fileTagsUploadSuccess, {
          create: result.created ?? rows.length,
          update: result.updated ?? 0,
          skip: result.skipped ?? 0,
        }),
    });
    void refreshUploadStatus();
  }

  async function handleFilesImport(
    rows: FileImportRow[],
    reportProgress: (
      percent: number,
      counts?: { done: number; total: number },
    ) => void,
  ) {
    setFilesMessage(null);
    const { created, updated, failures } = await importInBatches(
      rows,
      10,
      (batch) => importFilesAction(complexId, batch),
      (row) => ({ rowNumber: row.rowNumber, label: row.title }),
      dict.superAdmin.filesUploadFailed,
      reportProgress,
    );

    void refreshUploadStatus();
    if (failures.length > 0) {
      return { failures, succeeded: created + updated };
    }

    setFilesMessage({
      type: "success",
      text:
        updated > 0
          ? t(dict.superAdmin.filesUploadSuccessDetailed, { created, updated })
          : t(dict.superAdmin.filesUploadSuccess, {
              create: created,
              update: 0,
            }),
    });
  }

  function previewAttachmentRows(
    rows: FileAttachmentImportDocument[],
  ): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `file-attachment-${row.externalId}-${row.version}-${row.rowNumber}`,
      label: row.externalId,
      detail: [
        `id: ${row.externalId}`,
        `v${row.version}`,
        row.attachments.length > 0
          ? `${row.attachments.length} images`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
      action: "create" as const,
    }));
  }

  async function previewAttachmentRowsAsync(
    rows: FileAttachmentImportDocument[],
  ): Promise<ImportPreviewRow[] | { error: string }> {
    const result = await previewFileAttachmentsImportAction(complexId, rows);
    if (result.error) {
      return { error: result.error };
    }
    if (!result.items) {
      return previewAttachmentRows(rows);
    }

    const failedRows: ImportPreviewRow[] = (result.failures ?? []).map(
      (failure) => ({
        key: `file-attachment-failed-${failure.rowNumber}`,
        label: failure.label,
        detail: failure.error,
        action: "error",
      }),
    );

    return [...failedRows, ...result.items.map((item) => {
      const bits = [
        `series: ${item.externalId}`,
        `v${item.version}`,
        item.uploadCount > 0
          ? t(dict.superAdmin.fileAttachmentsPreviewUpload, {
              count: item.uploadCount,
            })
          : null,
        item.skipCount > 0
          ? t(dict.superAdmin.fileAttachmentsPreviewSkip, {
              count: item.skipCount,
            })
          : null,
        item.reuseCount > 0
          ? t(dict.superAdmin.fileAttachmentsPreviewReuse, {
              count: item.reuseCount,
            })
          : null,
      ].filter(Boolean);

      return {
        key: `file-attachment-${item.externalId}-${item.version}-${item.rowNumber}`,
        label: item.title,
        detail: bits.join(" · "),
        action: item.action,
      };
    })];
  }

  async function handleAttachmentsImport(
    rows: FileAttachmentImportDocument[],
    reportProgress: (
      percent: number,
      counts?: { done: number; total: number },
    ) => void,
  ) {
    setAttachmentsMessage(null);
    // Small batches: every row re-uploads its images, so a big batch left the
    // progress bar at 0% for minutes.
    const { created, updated, failures } = await importInBatches(
      rows,
      5,
      (batch) => importFileAttachmentsAction(complexId, batch),
      (row) => ({
        rowNumber: row.rowNumber,
        rowNumbers: row.sourceRowNumbers,
        label: `${row.externalId} · v${row.version}`,
      }),
      dict.superAdmin.fileAttachmentsUploadFailed,
      reportProgress,
    );

    void refreshUploadStatus();
    if (failures.length > 0) {
      return { failures, succeeded: created + updated };
    }

    setAttachmentsMessage({
      type: "success",
      text:
        updated > 0
          ? t(dict.superAdmin.fileAttachmentsUploadSuccessDetailed, {
              created,
              updated,
            })
          : t(dict.superAdmin.fileAttachmentsUploadSuccess, {
              create: created,
              update: 0,
            }),
    });
  }

  return (
    <div className="space-y-4">
      <UploadMessage message={tagsMessage} />
      <UploadCard
        stepNumber={1}
        title={dict.superAdmin.fileTagsUploadTitle}
        subtitle={dict.superAdmin.fileTagsUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setTagsUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.fileTags : undefined}
        guideLabel={dict.superAdmin.fileTagsImportGuideButton}
        onGuide={() => setTagsGuideOpen(true)}
      />

      <UploadMessage message={filesMessage} />
      <UploadCard
        stepNumber={2}
        title={dict.superAdmin.filesUploadTitle}
        subtitle={dict.superAdmin.filesUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setFilesUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.files : undefined}
      />

      <UploadMessage message={attachmentsMessage} />
      <UploadCard
        stepNumber={3}
        title={dict.superAdmin.fileAttachmentsUploadTitle}
        subtitle={dict.superAdmin.fileAttachmentsUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setAttachmentsUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.fileAttachments : undefined}
        guideLabel={dict.superAdmin.fileTagsImportGuideButton}
        onGuide={() => setAttachmentsGuideOpen(true)}
      />

      <DataUploadModal
        open={tagsUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.fileTagsUploadTitle,
          subtitle: dict.superAdmin.fileTagsUploadSubtitle,
          empty: dict.superAdmin.fileTagsUploadEmpty,
          invalid: dict.superAdmin.fileTagsUploadInvalid,
          invalidRow: dict.superAdmin.fileTagsUploadInvalidRow,
        }}
        csvFilename="file-tags-template.csv"
        excelFilename="file-tags-template.xls"
        buildCsv={buildFileTagsCsvTemplate}
        buildExcel={buildFileTagsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseFileTagsImportContent(content, fileName);
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.fileTagsUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        previewAsync={previewTagRows}
        onClose={() => setTagsUploadOpen(false)}
        onImport={handleTagsImport}
      />

      <DataUploadModal
        open={filesUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.filesUploadTitle,
          subtitle: dict.superAdmin.filesUploadSubtitle,
          empty: dict.superAdmin.filesUploadEmpty,
          invalid: dict.superAdmin.filesUploadInvalid,
          invalidRow: dict.superAdmin.filesUploadInvalidRow,
        }}
        csvFilename="files-template.csv"
        excelFilename="files-template.xls"
        buildCsv={buildFilesCsvTemplate}
        buildExcel={buildFilesExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseFilesImportContent(content, fileName);
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.filesUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        preview={previewFileRows}
        previewAsync={previewFileRowsAsync}
        onClose={() => setFilesUploadOpen(false)}
        onImport={handleFilesImport}
      />

      <DataUploadModal
        open={attachmentsUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.fileAttachmentsUploadTitle,
          subtitle: dict.superAdmin.fileAttachmentsUploadSubtitle,
          empty: dict.superAdmin.fileAttachmentsUploadEmpty,
          invalid: dict.superAdmin.fileAttachmentsUploadInvalid,
          invalidRow: dict.superAdmin.fileAttachmentsUploadInvalidRow,
        }}
        csvFilename="document-files-template.csv"
        excelFilename="document-files-template.xls"
        buildCsv={buildFileAttachmentsCsvTemplate}
        buildExcel={buildFileAttachmentsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseFileAttachmentsImportContent(content, fileName);
          if ("error" in parsed) {
            const notCloudinary = parseFileAttachmentNotCloudinaryMessage(
              parsed.message,
            );
            if (notCloudinary) {
              return {
                error: parsed.error,
                message: t(dict.superAdmin.uploadRowError, {
                  row: notCloudinary.row,
                  message: t(dict.superAdmin.fileAttachmentsNotCloudinary, {
                    url: notCloudinary.url,
                  }),
                }),
              };
            }
            if (parsed.message?.startsWith("__row__:")) {
              const row = parsed.message.slice("__row__:".length);
              return {
                error: parsed.error,
                message: t(dict.superAdmin.uploadRowError, {
                  row,
                  message: dict.superAdmin.fileAttachmentsUploadInvalidRow,
                }),
              };
            }
          }
          return parsed;
        }}
        preview={previewAttachmentRows}
        previewAsync={previewAttachmentRowsAsync}
        onClose={() => setAttachmentsUploadOpen(false)}
        onImport={handleAttachmentsImport}
      />

      <DevtoolsScriptGuideModal
        open={tagsGuideOpen}
        dict={dict}
        script={DOCUMENT_TAGS_EXPORT_SCRIPT}
        copy={{
          title: dict.superAdmin.fileTagsImportGuideTitle,
          intro: dict.superAdmin.fileTagsImportGuideIntro,
          step1Title: dict.superAdmin.fileTagsImportGuideStep1Title,
          step1Body: dict.superAdmin.fileTagsImportGuideStep1Body,
          step4Title: dict.superAdmin.fileTagsImportGuideStep4Title,
          step4Body: dict.superAdmin.fileTagsImportGuideStep4Body,
          scriptNote: dict.superAdmin.fileTagsImportGuideScriptNote,
        }}
        onClose={() => setTagsGuideOpen(false)}
      />

      <DevtoolsScriptGuideModal
        open={attachmentsGuideOpen}
        dict={dict}
        script={DOCUMENT_FILES_EXPORT_SCRIPT}
        copy={{
          title: dict.superAdmin.fileAttachmentsImportGuideTitle,
          intro: dict.superAdmin.fileAttachmentsImportGuideIntro,
          step1Title: dict.superAdmin.fileAttachmentsImportGuideStep1Title,
          step1Body: dict.superAdmin.fileAttachmentsImportGuideStep1Body,
          step4Title: dict.superAdmin.fileAttachmentsImportGuideStep4Title,
          step4Body: dict.superAdmin.fileAttachmentsImportGuideStep4Body,
          scriptNote: dict.superAdmin.fileAttachmentsImportGuideScriptNote,
        }}
        onClose={() => setAttachmentsGuideOpen(false)}
      />
    </div>
  );
}
