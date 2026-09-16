"use client";

import { useState } from "react";
import { importCategoriesAction } from "@/app/actions/super-admin";
import { CategoriesImportGuideModal } from "@/components/categories-import-guide-modal";
import { useComplexContext } from "@/components/complex-context";
import {
  DataUploadModal,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import { NoComplexSelectedHint, UploadMessage, UploadStatusBadge } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  buildCategoriesCsvTemplate,
  buildCategoriesExcelTemplate,
  parseCategoriesImportContent,
  type CategoryImportRow,
} from "@/lib/category-import";

export function CategoriesUploadPanels({
  dict,
  stepNumber,
}: {
  dict: Dictionary;
  /** Shows "N. " before the title, to mark this panel as one step in an ordered flow. */
  stepNumber?: number;
}) {
  const { complexId, selectedComplex, uploadStatus, refreshUploadStatus } = useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  function previewRows(rows: CategoryImportRow[]): ImportPreviewRow[] {
    const idsInFile = new Set(rows.map((row) => row.externalId));
    return rows.map((row) => {
      const parentExternalId = row.parentExternalId.trim();
      const missingParent =
        parentExternalId.length > 0 && !idsInFile.has(parentExternalId);
      return {
        key: `category-${row.externalId}`,
        label: row.name,
        detail: [
          `id: ${row.externalId}`,
          missingParent
            ? `skip: parent ${parentExternalId} not in file`
            : row.parentName
              ? `parent: ${row.parentName}`
              : parentExternalId
                ? `parent id: ${parentExternalId}`
                : "root",
        ].join(" · "),
        action: "create" as const,
      };
    });
  }

  async function handleImport(rows: CategoryImportRow[]) {
    setMessage(null);
    if (!complexId) return { error: dict.admin.complexNotFound };
    const result = await importCategoriesAction(complexId, rows);
    if (result.error) {
      return { error: result.error };
    }
    setMessage({
      type: "success",
      text:
        result.success ??
        t(dict.superAdmin.categoriesUploadSuccess, {
          create: result.created ?? rows.length,
          update: result.updated ?? 0,
          skipped: 0,
        }),
    });
    void refreshUploadStatus();
  }

  return (
    <div className="space-y-4">
      <UploadMessage message={message} />

      <section className="surface-card space-y-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">
                {stepNumber ? `${stepNumber}. ` : ""}
                {dict.superAdmin.categoriesUploadTitle}
              </h2>
              <UploadStatusBadge done={complexId ? uploadStatus?.categories : undefined} />
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              {dict.superAdmin.categoriesUploadSubtitle}
            </p>
            <button
              type="button"
              className="text-sm font-medium text-[var(--brand)] hover:text-[var(--brand-hover)] hover:underline"
              onClick={() => setGuideOpen(true)}
            >
              {dict.superAdmin.categoriesImportGuideButton}
            </button>
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
        {selectedComplex ? (
          <p className="text-xs text-[var(--text-muted)]">
            הקטגוריות ייובאו למתחם: <strong>{selectedComplex.name}</strong>
          </p>
        ) : (
          <NoComplexSelectedHint />
        )}
      </section>

      <DataUploadModal
        open={uploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.categoriesUploadTitle,
          subtitle: dict.superAdmin.categoriesUploadSubtitle,
          empty: dict.superAdmin.categoriesUploadEmpty,
          invalid: dict.superAdmin.categoriesUploadInvalid,
          invalidRow: dict.superAdmin.categoriesUploadInvalidRow,
        }}
        csvFilename="categories-template.csv"
        excelFilename="categories-template.xls"
        buildCsv={buildCategoriesCsvTemplate}
        buildExcel={buildCategoriesExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseCategoriesImportContent(content, fileName);
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            const row = parsed.message.slice("__row__:".length);
            return {
              error: parsed.error,
              message: t(dict.superAdmin.uploadRowError, {
                row,
                message: dict.superAdmin.categoriesUploadInvalidRow,
              }),
            };
          }
          return parsed;
        }}
        preview={previewRows}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />

      <CategoriesImportGuideModal
        open={guideOpen}
        dict={dict}
        onClose={() => setGuideOpen(false)}
      />
    </div>
  );
}
