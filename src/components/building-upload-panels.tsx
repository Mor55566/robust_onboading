"use client";

import { useEffect, useState } from "react";
import { importEquipmentAction } from "@/app/actions/admin-shared";
import {
  getBuildingsForComplexAction,
  type BuildingWithUploadCounts,
} from "@/app/actions/buildings";
import {
  importAreasForSuperAdminAction,
  importFloorsAction,
  previewAreasForSuperAdminAction,
} from "@/app/actions/super-admin";
import { useComplexContext } from "@/components/complex-context";
import { CreateBuildingModal } from "@/components/create-building-modal";
import {
  DataUploadModal,
  type ImportPreviewRow,
} from "@/components/data-upload-modal";
import {
  BuildingUploadStatusTable,
  UploadCard,
  UploadMessage,
} from "@/components/upload-card";
import type { Dictionary } from "@/i18n/dictionaries/en";
import { t } from "@/i18n/t";
import {
  formatGuardBlockError,
  GUARD_NOT_READY_MESSAGE,
} from "@/lib/complex-guard";
import {
  buildAreasCsvTemplate,
  buildAreasExcelTemplate,
  parseAreasImportContent,
  type AreaImportRow,
} from "@/lib/area-import";
import {
  buildEquipmentCsvTemplate,
  buildEquipmentExcelTemplate,
  buildFloorsCsvTemplate,
  buildFloorsExcelTemplate,
  parseEquipmentImportContent,
  parseFloorsImportContent,
  type EquipmentImportRow,
  type FloorImportRow,
} from "@/lib/data-import";

export function BuildingUploadPanels({ dict }: { dict: Dictionary }) {
  const { complexId, checkBuildingNames, guardDirectoryReady, refreshUploadStatus } =
    useComplexContext();
  const [floorsUploadOpen, setFloorsUploadOpen] = useState(false);
  const [areasUploadOpen, setAreasUploadOpen] = useState(false);
  const [equipmentUploadOpen, setEquipmentUploadOpen] = useState(false);
  const [createBuildingOpen, setCreateBuildingOpen] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  const [buildings, setBuildings] = useState<BuildingWithUploadCounts[]>([]);
  const [floorsBuildingId, setFloorsBuildingId] = useState("");
  const floorsAllDone =
    buildings.length > 0 && buildings.every((building) => building.floorCount > 0);
  const areasAllDone =
    buildings.length > 0 && buildings.every((building) => building.areaCount > 0);
  const equipmentAllDone =
    buildings.length > 0 && buildings.every((building) => building.equipmentCount > 0);

  useEffect(() => {
    setFloorsBuildingId("");
    if (!complexId) {
      setBuildings([]);
      return;
    }
    let cancelled = false;
    void getBuildingsForComplexAction(complexId).then((result) => {
      if (!cancelled) setBuildings(result);
    });
    return () => {
      cancelled = true;
    };
  }, [complexId]);

  async function refreshBuildings() {
    if (!complexId) return;
    const result = await getBuildingsForComplexAction(complexId);
    setBuildings(result);
  }

  function previewFloorRows(rows: FloorImportRow[]): ImportPreviewRow[] {
    return rows.map((row, index) => ({
      key: `floor-${index}`,
      label: row.name,
      detail: `${dict.superAdmin.floorLevel} ${row.number}${
        row.externalId
          ? ` · ${dict.superAdmin.floorExternalId}: ${row.externalId}`
          : ""
      }`,
      action: "create" as const,
    }));
  }

  async function handleFloorsImport(
    rows: FloorImportRow[],
    reportProgress: (percent: number) => void,
  ) {
    setMessage(null);
    if (!floorsBuildingId) return { error: dict.superAdmin.floorsUploadBuildingRequired };
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    reportProgress(10);
    const result = await importFloorsAction(rows, floorsBuildingId);
    if (result.error) return { error: result.error };
    reportProgress(100);
    setMessage({
      type: "success",
      text: t(dict.superAdmin.floorsUploadSuccess, {
        created: result.created ?? 0,
        updated: result.updated ?? 0,
      }),
    });
    void refreshUploadStatus();
    void refreshBuildings();
  }

  async function previewAreaRows(rows: AreaImportRow[]) {
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.map((row) => row.building || row.location));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    const result = await previewAreasForSuperAdminAction(rows);
    if (result.error || !result.rows) {
      return { error: result.error ?? dict.superAdmin.areasUploadInvalid };
    }
    return result.rows;
  }

  async function handleAreasImport(
    rows: AreaImportRow[],
    reportProgress: (percent: number) => void,
  ) {
    setMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.map((row) => row.building || row.location));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    reportProgress(10);
    const result = await importAreasForSuperAdminAction(rows);
    if (result.error) return { error: result.error };
    reportProgress(100);
    setMessage({
      type: "success",
      text: t(dict.superAdmin.areasUploadSuccess, {
        created: result.created ?? 0,
        updated: result.updated ?? 0,
      }),
    });
    void refreshUploadStatus();
    void refreshBuildings();
  }

  async function previewEquipmentRows(
    rows: EquipmentImportRow[],
  ): Promise<ImportPreviewRow[] | { error: string }> {
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.map((row) => row.building));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    const result = await importEquipmentAction(null, rows, {
      externalIdOnly: true,
      previewOnly: true,
    });
    if (result.error || !result.preview) {
      return { error: result.error ?? dict.superAdmin.equipmentUploadInvalid };
    }
    return result.preview;
  }

  async function handleEquipmentImport(
    rows: EquipmentImportRow[],
    reportProgress: (percent: number) => void,
  ) {
    setMessage(null);
    if (!guardDirectoryReady) return { error: GUARD_NOT_READY_MESSAGE };
    const issues = checkBuildingNames(rows.map((row) => row.building));
    if (issues.length > 0) return { error: formatGuardBlockError(issues) };
    reportProgress(10);
    const result = await importEquipmentAction(null, rows, {
      externalIdOnly: true,
    });
    if (result.error) return { error: result.error };
    reportProgress(100);
    setMessage({
      type: "success",
      text: t(dict.superAdmin.equipmentUploadSuccess, {
        created: result.created ?? 0,
        updated: result.updated ?? 0,
      }),
    });
    void refreshUploadStatus();
    void refreshBuildings();
  }

  return (
    <div className="space-y-4">
      <UploadMessage message={message} />

      <section className="surface-card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold">{dict.admin.buildingsInComplex}</h2>
          </div>
          <button
            type="button"
            className="btn btn-primary shrink-0"
            disabled={!complexId}
            onClick={() => setCreateBuildingOpen(true)}
          >
            {dict.admin.buildingAdd}
          </button>
        </div>
      </section>

      <UploadCard
        title={dict.superAdmin.floorsUploadTitle}
        subtitle={dict.superAdmin.floorsUploadSubtitle}
        buttonLabel={dict.superAdmin.floorsUploadButton}
        onOpen={() => setFloorsUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? floorsAllDone : undefined}
      >
        {complexId ? (
          <BuildingUploadStatusTable
            rows={buildings.map((building) => ({
              id: building.id,
              name: building.name,
              count: building.floorCount,
            }))}
          />
        ) : null}
      </UploadCard>
      <UploadCard
        title={dict.superAdmin.areasUploadTitle}
        subtitle={dict.superAdmin.areasUploadSubtitle}
        buttonLabel={dict.superAdmin.areasUploadButton}
        onOpen={() => setAreasUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? areasAllDone : undefined}
      >
        {complexId ? (
          <BuildingUploadStatusTable
            rows={buildings.map((building) => ({
              id: building.id,
              name: building.name,
              count: building.areaCount,
            }))}
          />
        ) : null}
      </UploadCard>
      <UploadCard
        title={dict.superAdmin.equipmentUploadTitle}
        subtitle={dict.superAdmin.equipmentUploadSubtitle}
        buttonLabel={dict.superAdmin.equipmentUploadButton}
        onOpen={() => setEquipmentUploadOpen(true)}
        disabled={!complexId}
        done={complexId ? equipmentAllDone : undefined}
      >
        {complexId ? (
          <BuildingUploadStatusTable
            rows={buildings.map((building) => ({
              id: building.id,
              name: building.name,
              count: building.equipmentCount,
            }))}
          />
        ) : null}
      </UploadCard>

      <DataUploadModal
        open={floorsUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.floorsUploadTitle,
          subtitle: dict.superAdmin.floorsUploadSubtitle,
          empty: dict.superAdmin.floorsUploadEmpty,
          invalid: dict.superAdmin.floorsUploadInvalid,
          invalidRow: dict.superAdmin.floorsUploadInvalidRow,
        }}
        csvFilename="floors-template.csv"
        excelFilename="floors-template.xls"
        buildCsv={buildFloorsCsvTemplate}
        buildExcel={buildFloorsExcelTemplate}
        parse={parseFloorsImportContent}
        preview={previewFloorRows}
        canImport={!!floorsBuildingId}
        extraFields={
          <div className="space-y-2">
            <label htmlFor="floors-upload-building" className="field-label">
              {dict.superAdmin.floorsUploadBuildingLabel}
            </label>
            <select
              id="floors-upload-building"
              value={floorsBuildingId}
              onChange={(event) => setFloorsBuildingId(event.target.value)}
            >
              <option value="">
                {dict.superAdmin.floorsUploadBuildingPlaceholder}
              </option>
              {buildings.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </select>
          </div>
        }
        onClose={() => setFloorsUploadOpen(false)}
        onImport={handleFloorsImport}
      />
      <DataUploadModal
        open={areasUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.areasUploadTitle,
          subtitle: dict.superAdmin.areasUploadSubtitle,
          empty: dict.superAdmin.areasUploadEmpty,
          invalid: dict.superAdmin.areasUploadInvalid,
          invalidRow: dict.superAdmin.areasUploadInvalidRow,
        }}
        csvFilename="areas-template.csv"
        excelFilename="areas-template.xls"
        parse={(content, fileName) => {
          const result = parseAreasImportContent(content, fileName);
          if ("error" in result) {
            return {
              error:
                result.error.code === "empty"
                  ? ("empty" as const)
                  : result.error.code === "invalid"
                    ? ("invalid" as const)
                    : ("invalidRow" as const),
              message: result.error.message,
            };
          }
          return result;
        }}
        buildCsv={buildAreasCsvTemplate}
        buildExcel={buildAreasExcelTemplate}
        previewAsync={previewAreaRows}
        hideSkippedRows
        onClose={() => setAreasUploadOpen(false)}
        onImport={handleAreasImport}
      />
      <DataUploadModal
        open={equipmentUploadOpen}
        dict={dict}
        copy={{
          title: dict.superAdmin.equipmentUploadTitle,
          subtitle: dict.superAdmin.equipmentUploadSubtitle,
          empty: dict.superAdmin.equipmentUploadEmpty,
          invalid: dict.superAdmin.equipmentUploadInvalid,
          invalidRow: dict.superAdmin.equipmentUploadInvalidRow,
        }}
        csvFilename="equipment-template.csv"
        excelFilename="equipment-template.xls"
        buildCsv={buildEquipmentCsvTemplate}
        buildExcel={buildEquipmentExcelTemplate}
        parse={parseEquipmentImportContent}
        previewAsync={previewEquipmentRows}
        hideSkippedRows
        onClose={() => setEquipmentUploadOpen(false)}
        onImport={handleEquipmentImport}
      />
      <CreateBuildingModal
        open={createBuildingOpen}
        complexId={complexId}
        dict={dict}
        onClose={() => setCreateBuildingOpen(false)}
        onCreated={(building) => {
          setCreateBuildingOpen(false);
          setMessage({
            type: "success",
            text: `${dict.admin.buildingCreated}: ${building.name}`,
          });
          void refreshBuildings();
        }}
      />
    </div>
  );
}
