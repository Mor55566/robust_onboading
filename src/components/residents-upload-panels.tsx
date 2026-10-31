"use client";

import { useState } from "react";
import {
  importResidentUsersAction,
  importResidentsAction,
} from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import { DevtoolsScriptGuideModal } from "@/components/devtools-script-guide-modal";
import { UploadCard } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  buildResidentsCsvTemplate,
  buildResidentsExcelTemplate,
  parseResidentsImportContent,
  type ResidentImportRow,
} from "@/lib/resident-import";
import {
  buildResidentUsersCsvTemplate,
  buildResidentUsersExcelTemplate,
  parseResidentUsersImportContent,
  type ResidentUserImportRow,
} from "@/lib/resident-user-import";
import { TENANT_USERS_EXPORT_SCRIPT } from "@/lib/tenant-users-export-script";

export function ResidentsUploadPanels({ dict }: { dict: Dictionary }) {
  const { complexId, uploadStatus, refreshUploadStatus } = useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [usersUploadOpen, setUsersUploadOpen] = useState(false);
  const [usersGuideOpen, setUsersGuideOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function previewRows(rows: ResidentImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `${row.externalId}-${row.building}-${row.rowNumber}`,
      label: row.name,
      detail: row.building || dict.superAdmin.residentsEntireComplex,
      action: "create",
    }));
  }

  function previewUserRows(rows: ResidentUserImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => ({
      key: `${row.resident}-${row.name}-${row.rowNumber}`,
      label: row.name,
      detail: [row.resident, row.role, row.email || row.phone]
        .filter(Boolean)
        .join(" · "),
      action: "create",
    }));
  }

  function withRowError<T>(
    parsed: { rows: T[] } | { error: "invalid" | "empty" | "invalidRow"; message?: string },
    invalidRow: string,
  ) {
    if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
      return {
        error: parsed.error,
        message: t(dict.superAdmin.uploadRowError, {
          row: parsed.message.slice("__row__:".length),
          message: invalidRow,
        }),
      };
    }
    return parsed;
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

  async function handleUsersImport(rows: ResidentUserImportRow[]) {
    setMessage(null);
    const result = await importResidentUsersAction(complexId, rows);
    if (result.error) return { error: result.error };
    setMessage(result.success ?? null);
    void refreshUploadStatus();
  }

  return (
    <div className="space-y-4">
      {message ? <p className="banner-success">{message}</p> : null}
      <UploadCard
        title={dict.superAdmin.residentsUploadTitle}
        subtitle={dict.superAdmin.residentsUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.residents : undefined}
        stepNumber={1}
      />
      <UploadCard
        title={dict.superAdmin.residentUsersUploadTitle}
        subtitle={dict.superAdmin.residentUsersUploadSubtitle}
        buttonLabel={dict.admin.uploadData}
        onOpen={() => setUsersUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? uploadStatus?.residentUsers : undefined}
        stepNumber={2}
        guideLabel={dict.superAdmin.fileTagsImportGuideButton}
        onGuide={() => setUsersGuideOpen(true)}
      />
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
        parse={(content, fileName) =>
          withRowError(
            parseResidentsImportContent(content, fileName),
            dict.superAdmin.residentsUploadInvalidRow,
          )
        }
        preview={previewRows}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />
      <DataUploadModal
        open={usersUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.residentUsersUploadTitle,
          subtitle: dict.superAdmin.residentUsersUploadSubtitle,
          empty: dict.superAdmin.residentUsersUploadEmpty,
          invalid: dict.superAdmin.residentUsersUploadInvalid,
          invalidRow: dict.superAdmin.residentUsersUploadInvalidRow,
        }}
        csvFilename="tenant-users-template.csv"
        excelFilename="tenant-users-template.xls"
        buildCsv={buildResidentUsersCsvTemplate}
        buildExcel={buildResidentUsersExcelTemplate}
        parse={(content, fileName) =>
          withRowError(
            parseResidentUsersImportContent(content, fileName),
            dict.superAdmin.residentUsersUploadInvalidRow,
          )
        }
        preview={previewUserRows}
        onClose={() => setUsersUploadOpen(false)}
        onImport={handleUsersImport}
      />
      <DevtoolsScriptGuideModal
        open={usersGuideOpen}
        dict={dict}
        script={TENANT_USERS_EXPORT_SCRIPT}
        copy={{
          title: dict.superAdmin.residentUsersImportGuideTitle,
          intro: dict.superAdmin.residentUsersImportGuideIntro,
          step1Title: dict.superAdmin.residentUsersImportGuideStep1Title,
          step1Body: dict.superAdmin.residentUsersImportGuideStep1Body,
          step1Image: {
            src: "/guides/visitt-tenants-nav.png",
            alt: dict.superAdmin.residentUsersImportGuideStep1Title,
          },
          step4Title: dict.superAdmin.residentUsersImportGuideStep4Title,
          step4Body: dict.superAdmin.residentUsersImportGuideStep4Body,
          scriptNote: dict.superAdmin.residentUsersImportGuideScriptNote,
        }}
        onClose={() => setUsersGuideOpen(false)}
      />
    </div>
  );
}
