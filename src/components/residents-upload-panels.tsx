"use client";

import { useState } from "react";
import { importResidentsAction } from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import { NoComplexSelectedHint, UploadStatusBadge } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  buildResidentsCsvTemplate,
  buildResidentsExcelTemplate,
  parseResidentsImportContent,
  type ResidentImportRow,
} from "@/lib/resident-import";

export function ResidentsUploadPanels({ dict }: { dict: Dictionary }) {
  const { complexId, uploadStatus, refreshUploadStatus } = useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function previewRows(rows: ResidentImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `${row.externalId}-${row.building}-${row.rowNumber}`,
      label: row.name,
      detail: row.building || dict.superAdmin.residentsEntireComplex,
      action: "create",
    }));
  }

  async function handleImport(rows: ResidentImportRow[]) {
    setMessage(null);
    const result = await importResidentsAction(complexId, rows);
    if (result.error) return { error: result.error };
    setMessage(
      result.success ??
        t(dict.superAdmin.residentsUploadSuccess, {
          create: result.created ?? 0,
          update: result.updated ?? 0,
        }),
    );
    void refreshUploadStatus();
  }

  return (
    <div className="space-y-4">
      {message ? <p className="banner-success">{message}</p> : null}
      <section className="surface-card space-y-2 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                {dict.superAdmin.residentsUploadTitle}
              </h2>
              <UploadStatusBadge done={complexId ? uploadStatus?.residents : undefined} />
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              {dict.superAdmin.residentsUploadSubtitle}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={!complexId}
            onClick={() => setUploadOpen(true)}
          >
            {dict.admin.uploadData}
          </button>
        </div>
        {!complexId ? <NoComplexSelectedHint /> : null}
      </section>
      <DataUploadModal
        open={uploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.residentsUploadTitle,
          subtitle: dict.superAdmin.residentsUploadSubtitle,
          empty: dict.superAdmin.residentsUploadEmpty,
          invalid: dict.superAdmin.residentsUploadInvalid,
          invalidRow: dict.superAdmin.residentsUploadInvalidRow,
        }}
        csvFilename="residents-template.csv"
        excelFilename="residents-template.xls"
        buildCsv={buildResidentsCsvTemplate}
        buildExcel={buildResidentsExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseResidentsImportContent(content, fileName);
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row: parsed.message.slice("__row__:".length),
                message: dict.superAdmin.residentsUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        preview={previewRows}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />
    </div>
  );
}
