"use client";

import { useState } from "react";
import { importUsersAction } from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import { CreateUserModal } from "@/components/create-user-modal";
import { DataUploadModal, type ImportPreviewRow } from "@/components/data-upload-modal";
import { NoComplexSelectedHint, UploadStatusBadge } from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  buildUsersCsvTemplate,
  buildUsersExcelTemplate,
  isVisittUser,
  parseUsersImportContent,
  type UserImportRow,
} from "@/lib/user-import";

export function UsersUploadPanels({ dict }: { dict: Dictionary }) {
  const { complexId, uploadStatus, refreshUploadStatus } = useComplexContext();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function preview(rows: UserImportRow[]): ImportPreviewRow[] {
    return rows.map((row) => {
      const visitt = isVisittUser(row);
      const role = row.sourceRole === "מנהל נכס" ? dict.roles.admin : dict.roles.user;
      return {
        key: `${row.email}-${row.rowNumber}`,
        label: row.fullName,
        detail: visitt
          ? `${row.email} · ${dict.superAdmin.usersUploadVisittSkipped}`
          : `${row.email} · ${role}`,
        action: visitt ? "skip" : "create",
      };
    });
  }

  async function handleImport(rows: UserImportRow[]) {
    setMessage(null);
    const importable = rows.filter((row) => !isVisittUser(row));
    if (importable.length === 0) return { error: dict.superAdmin.usersUploadEmpty };
    const result = await importUsersAction(complexId, importable);
    if (result.error) return { error: result.error };
    setMessage(result.success ?? t(dict.superAdmin.usersUploadSuccess, {
      create: result.created ?? 0,
      update: result.updated ?? 0,
    }));
    void refreshUploadStatus();
  }

  return (
    <div className="space-y-4">
      {message ? <p className="banner-success">{message}</p> : null}
      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{dict.admin.tabUsers}</h2>
          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={!complexId}
            onClick={() => setCreateUserOpen(true)}
          >
            {dict.superAdmin.usersAddNew}
          </button>
        </div>
        {!complexId ? <NoComplexSelectedHint /> : null}
      </section>
      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{dict.superAdmin.usersUploadTitle}</h2>
              <UploadStatusBadge done={complexId ? uploadStatus?.users : undefined} />
            </div>
            <p className="text-sm text-[var(--text-muted)]">{dict.superAdmin.usersUploadSubtitle}</p>
          </div>
          <button type="button" className="btn btn-primary shrink-0" disabled={!complexId} onClick={() => setUploadOpen(true)}>
            {dict.admin.uploadData}
          </button>
        </div>
        {!complexId ? <NoComplexSelectedHint /> : null}
      </section>
      <DataUploadModal
        open={uploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.usersUploadTitle,
          subtitle: dict.superAdmin.usersUploadSubtitle,
          empty: dict.superAdmin.usersUploadEmpty,
          invalid: dict.superAdmin.usersUploadInvalid,
          invalidRow: dict.superAdmin.usersUploadInvalidRow,
        }}
        csvFilename="users-template.csv"
        excelFilename="users-template.xls"
        buildCsv={buildUsersCsvTemplate}
        buildExcel={buildUsersExcelTemplate}
        parse={(content, fileName) => {
          const parsed = parseUsersImportContent(content, fileName);
          if ("error" in parsed && parsed.message?.startsWith("__row__:")) {
            return { error: parsed.error, message: t(dict.superAdmin.uploadRowError, {
              row: parsed.message.slice("__row__:".length),
              message: dict.superAdmin.usersUploadInvalidRow,
            }) };
          }
          return parsed;
        }}
        preview={preview}
        onClose={() => setUploadOpen(false)}
        onImport={handleImport}
      />
      <CreateUserModal
        open={createUserOpen}
        complexId={complexId}
        dict={dict}
        onClose={() => setCreateUserOpen(false)}
        onCreated={(createdUser) => {
          setCreateUserOpen(false);
          setMessage(`${dict.superAdmin.userCreated}: ${createdUser.fullName}`);
          void refreshUploadStatus();
        }}
      />
    </div>
  );
}
