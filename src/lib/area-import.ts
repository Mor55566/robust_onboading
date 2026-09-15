/**
 * Areas CSV import helpers.
 *
 * Location hierarchy uses "<" or ">" between segments. Slashes are part of the
 * area/floor name (e.g. "מנהרה / חדר מרכז אנרגיה"), not hierarchy delimiters.
 *
 * Examples:
 * - "מנהרה / חדר מרכז אנרגיה"
 *     → area "מנהרה / חדר מרכז אנרגיה" (building-level)
 * - "מנהרה / חדר מרכז אנרגיה < מינוס 1 / עמדת כיבוי אש"
 *     → area "מינוס 1 / עמדת כיבוי אש" under area "מנהרה / חדר מרכז אנרגיה"
 * - "בניין A / קומה 2 < קומה 2 / לובי מעליות משא"
 *     → area "קומה 2 / לובי מעליות משא" under floor 2
 * - "קומה קרקע < דלת מסתובבת - כניסה"
 *     → area under floor 0 (ground)
 * - "מינוס 1 / גרעין B < בניין B / מינוס 1 / מבוא לחדרי חשמל חניון"
 *     → area under parent "גרעין B" on floor -1
 */

import { MAX_AREA_NESTING_LEVELS } from "@/lib/area-nesting";

export const AREA_IMPORT_HEADERS = [
  "#", "מזהה", "מיקום", "בניין", "שם", "סוג", "קוד יחידה", "מס\"ד",
  "מפרט", "קטגוריית אתרים", "כתובת", "קוד QR", "תאריך יצירה",
] as const;

export type AreaImportFloor = {
  id: string;
  name: string;
  number: number;
};

export type AreaImportExisting = {
  id: string;
  name: string;
  floor_id: string | null;
  parent_area_id: string | null;
  external_id?: string | null;
  area_type?: string | null;
  qr_code?: string | null;
};

export type AreaImportRow = {
  rowNumber: number;
  building?: string;
  externalId: string;
  location: string;
  name: string;
  type: string;
  qrCode: string;
};

export type AreaImportParseError = {
  rowNumber: number | null;
  field?: string;
  value?: string;
  code:
    | "empty"
    | "invalid"
    | "missingHeader"
    | "missingRequired"
    | "invalidRow";
  message: string;
};

export type AreaImportPlanItem = {
  rowNumber: number;
  action: "create" | "update";
  name: string;
  externalId: string | null;
  type: string | null;
  qrCode: string | null;
  floorId: string | null;
  parentAreaId: string | null;
  /** Existing area id when updating; new uuid when creating. */
  areaId: string;
  locationLabel: string;
  /** Parent areas that must exist (created earlier in the plan if needed). */
  parentChain: { name: string; areaId: string; action: "create" | "update" | "exists" }[];
};

export type AreaImportIssue = {
  rowNumber: number;
  field?: string;
  value?: string;
  code:
    | "unknownFloor"
    | "ambiguousFloor"
    | "ambiguousPath"
    | "missingRequired"
    | "nestingTooDeep"
    | "duplicateExternalId"
    | "duplicateQrCode"
    | "conflict";
  message: string;
  /** Recognized floor label when code is unknownFloor. */
  floorLabel?: string;
  /** Recognized floor number when code is unknownFloor. */
  floorNumber?: number;
};

/**
 * Rows that fail to resolve (e.g. an unknown floor) are excluded from `items`
 * and reported in `issues` instead of aborting the whole plan — callers skip
 * those rows and import everything else.
 */
export type AreaImportPlanResult = {
  items: AreaImportPlanItem[];
  createdParents: AreaImportPlanItem[];
  issues: AreaImportIssue[];
};

const NAME_DELIMITER = " / ";
const HIERARCHY_SPLIT = /\s*[<>]\s*/;

export function buildAreasCsvTemplate(): string {
  const samples = [
    ["1", "area-lobby", "קומת קרקע < לובי ראשי", "בניין A", "לובי ראשי", "", "", "", "", "אזור בסיסי", "", "QR-100", ""],
    ["2", "area-electric", "בניין A / קומה 1 < חדר חשמל", "בניין A", "חדר חשמל", "חדר חשמל", "", "", "", "אזור בסיסי", "", "QR-101", ""],
  ];
  const rows = [
    AREA_IMPORT_HEADERS.map(escapeCsvValue).join(","),
    ...samples.map((row) => row.map(escapeCsvValue).join(",")),
  ];
  return `\uFEFF${rows.join("\n")}\n`;
}

export function buildAreasExcelTemplate(): string {
  const headerCells = AREA_IMPORT_HEADERS.map(
    (header) =>
      `<Cell><Data ss:Type="String">${escapeXml(header)}</Data></Cell>`,
  ).join("");
  const samples: string[][] = [
    ["1", "area-lobby", "קומת קרקע < לובי ראשי", "בניין A", "לובי ראשי", "", "", "", "", "אזור בסיסי", "", "QR-100", ""],
    ["2", "area-electric", "בניין A / קומה 1 < חדר חשמל", "בניין A", "חדר חשמל", "חדר חשמל", "", "", "", "אזור בסיסי", "", "QR-101", ""],
  ];
  const dataRows = samples
    .map((row) => {
      const cells = row
        .map(
          (value) =>
            `<Cell><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`,
        )
        .join("");
      return `<Row>${cells}</Row>`;
    })
    .join("");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Areas">
  <Table>
   <Row>${headerCells}</Row>
   ${dataRows}
  </Table>
 </Worksheet>
</Workbook>
`;
}

export function parseAreasImportContent(
  content: string,
  fileName: string,
): { rows: AreaImportRow[] } | { error: AreaImportParseError } {
  const trimmed = content.replace(/^\uFEFF/, "").trim();
  if (!trimmed) {
    return {
      error: {
        rowNumber: null,
        code: "empty",
        message: "No area rows found in the file.",
      },
    };
  }

  if (trimmed.startsWith("PK")) {
    return {
      error: {
        rowNumber: null,
        code: "invalid",
        message:
          "Could not read this file. Download the CSV or Excel template and try again.",
      },
    };
  }

  const lowerName = fileName.toLowerCase();
  const looksLikeXml =
    trimmed.startsWith("<?xml") ||
    trimmed.includes("urn:schemas-microsoft-com:office:spreadsheet") ||
    lowerName.endsWith(".xls") ||
    lowerName.endsWith(".xml");

  const rawRows = looksLikeXml
    ? parseSpreadsheetMlRows(trimmed)
    : parseCsvRows(trimmed, detectCsvDelimiterLocal(trimmed));

  if (!rawRows || rawRows.length === 0) {
    return {
      error: {
        rowNumber: null,
        code: "invalid",
        message:
          "Could not read this file. Download the CSV or Excel template and try again.",
      },
    };
  }

  const header = rawRows[0].map((cell) => normalizeHeader(cell));
  const indexes = {
    externalId: findHeaderIndex(header, ["external id", "external_id", "מזהה"]),
    location: findHeaderIndex(header, ["location", "מיקום"]),
    building: findHeaderIndex(header, ["building", "building name", "בניין"]),
    name: findHeaderIndex(header, ["name", "שם"]),
    type: findHeaderIndex(header, ["type", "area type", "area_type", "סוג"]),
    qrCode: findHeaderIndex(header, ["qr code", "qr_code", "qrcode", "קוד qr"]),
  };

  if (
    indexes.location < 0 ||
    indexes.type < 0 ||
    indexes.qrCode < 0
  ) {
    return {
      error: {
        rowNumber: 1,
        code: "missingHeader",
        field: "header",
        value: rawRows[0].join(","),
        message:
          "Missing required columns. Expected: external id, location, name, type, QR code.",
      },
    };
  }

  const rows: AreaImportRow[] = [];
  for (let i = 1; i < rawRows.length; i += 1) {
    const cells = rawRows[i];
    if (cells.every((cell) => !cell.trim())) continue;
    const rowNumber = i + 1;
    const externalId = normalizeWhitespace(
      cells[indexes.externalId] ?? "",
    );
    const building = indexes.building >= 0
      ? normalizeWhitespace(cells[indexes.building] ?? "")
      : "";
    const location = normalizeWhitespace(cells[indexes.location] ?? "");
    const nameFromColumn =
      indexes.name >= 0
        ? normalizeWhitespace(cells[indexes.name] ?? "")
        : "";
    const type = normalizeWhitespace(cells[indexes.type] ?? "");
    const qrCode = normalizeWhitespace(cells[indexes.qrCode] ?? "");

    if (!location) {
      return {
        error: {
          rowNumber,
          code: "missingRequired",
          field: "location",
          value: location,
          message: `Row ${rowNumber}: location is required.`,
        },
      };
    }

    const segments = splitLocationHierarchy(location);
    const leafFromLocation = segments[segments.length - 1] ?? "";
    const name = nameFromColumn || leafFromLocation;
    if (!name) {
      return {
        error: {
          rowNumber,
          code: "missingRequired",
          field: "name",
          value: name,
          message: `Row ${rowNumber}: name is required (or include it as the last location segment).`,
        },
      };
    }

    rows.push({ rowNumber, building, externalId, location, name, type, qrCode });
  }

  if (rows.length === 0) {
    return {
      error: {
        rowNumber: null,
        code: "empty",
        message: "No area rows found in the file.",
      },
    };
  }

  return { rows };
}

export function planAreasImport(options: {
  rows: AreaImportRow[];
  floors: AreaImportFloor[];
  areas: AreaImportExisting[];
  buildingName: string;
  createId?: () => string;
  matchExistingByExternalIdOnly?: boolean;
}): AreaImportPlanResult {
  const createId = options.createId ?? (() => crypto.randomUUID());
  const issues: AreaImportIssue[] = [];
  const items: AreaImportPlanItem[] = [];
  const createdParents: AreaImportPlanItem[] = [];

  type WorkingArea = AreaImportExisting & {
    provisional?: boolean;
  };

  const working: WorkingArea[] = options.areas.map((area) => ({ ...area }));
  const externalIdOwner = new Map<string, string>();
  const qrCodeOwner = new Map<string, string>();

  for (const area of working) {
    if (area.external_id) {
      externalIdOwner.set(normalizeKey(area.external_id), area.id);
    }
    if (area.qr_code) {
      qrCodeOwner.set(normalizeKey(area.qr_code), area.id);
    }
  }

  function findScopedArea(
    name: string,
    floorId: string | null,
    parentAreaId: string | null,
  ) {
    return working.find((area) => {
      if (!namesMatch(area.name, name)) return false;
      if (parentAreaId) {
        return area.parent_area_id === parentAreaId;
      }
      return (
        (area.floor_id ?? null) === floorId && !area.parent_area_id
      );
    });
  }

  function resolveAreaFloorId(area: WorkingArea, seen = new Set<string>()): string | null {
    if (area.floor_id) return area.floor_id;
    if (!area.parent_area_id || seen.has(area.id)) return null;
    seen.add(area.id);
    const parent = working.find((item) => item.id === area.parent_area_id);
    return parent ? resolveAreaFloorId(parent, seen) : null;
  }

  for (const row of options.rows) {
    const resolved = resolveLocationPath(
      row.location,
      options.floors,
      options.buildingName,
      row.name,
    );
    if (!resolved.ok) {
      issues.push({
        rowNumber: row.rowNumber,
        field: "location",
        value: row.location,
        code: resolved.code,
        message: `Row ${row.rowNumber}: ${resolved.message}`,
        floorLabel: resolved.floorLabel,
        floorNumber: resolved.floorNumber,
      });
      continue;
    }

    const { floor, parentNames, leafName } = resolved;
    const areaName = leafName;
    if (parentNames.length + 1 > MAX_AREA_NESTING_LEVELS) {
      issues.push({
        rowNumber: row.rowNumber,
        field: "location",
        value: row.location,
        code: "nestingTooDeep",
        message: `Row ${row.rowNumber}: area nesting exceeds the maximum of ${MAX_AREA_NESTING_LEVELS} levels.`,
      });
      continue;
    }

    const parentChain: AreaImportPlanItem["parentChain"] = [];
    let parentAreaId: string | null = null;
    const floorId = floor?.id ?? null;

    for (const parentName of parentNames) {
      const existingParent = findScopedArea(parentName, floorId, parentAreaId);
      if (existingParent) {
        parentChain.push({
          name: parentName,
          areaId: existingParent.id,
          action: existingParent.provisional ? "create" : "exists",
        });
        parentAreaId = existingParent.id;
        continue;
      }

      const parentId = createId();
      const parentDepth = parentChain.length;
      if (parentDepth + 1 >= MAX_AREA_NESTING_LEVELS) {
        issues.push({
          rowNumber: row.rowNumber,
          field: "location",
          value: row.location,
          code: "nestingTooDeep",
          message: `Row ${row.rowNumber}: area nesting exceeds the maximum of ${MAX_AREA_NESTING_LEVELS} levels.`,
        });
        parentAreaId = null;
        break;
      }

      const parentItem: WorkingArea = {
        id: parentId,
        name: parentName,
        floor_id: parentAreaId ? null : floorId,
        parent_area_id: parentAreaId,
        provisional: true,
      };
      working.push(parentItem);
      parentChain.push({
        name: parentName,
        areaId: parentId,
        action: "create",
      });
      createdParents.push({
        rowNumber: row.rowNumber,
        action: "create",
        name: parentName,
        externalId: null,
        type: null,
        qrCode: null,
        floorId,
        parentAreaId,
        areaId: parentId,
        locationLabel: [
          ...(floor ? [floorPathLabel(floor, options.buildingName)] : []),
          ...parentNames.slice(0, parentChain.length - 1),
        ].join(" < "),
        parentChain: parentChain.slice(0, -1),
      });
      parentAreaId = parentId;
    }

    if (issues.some((issue) => issue.rowNumber === row.rowNumber)) {
      continue;
    }

    const externalId = row.externalId || null;
    const qrCode = row.qrCode || null;
    const type = row.type || null;

    let existing: WorkingArea | undefined;
    if (externalId) {
      const ownerId = externalIdOwner.get(normalizeKey(externalId));
      if (ownerId) {
        existing = working.find((area) => area.id === ownerId);
      }
    }
    if (!existing && !options.matchExistingByExternalIdOnly) {
      existing = findScopedArea(areaName, floorId, parentAreaId);
    }

    if (existing) {
      const existingFloorId = resolveAreaFloorId(existing);
      if (
        externalId &&
        existing.external_id &&
        namesMatch(existing.external_id, externalId) &&
        (existingFloorId !== floorId ||
          (existing.parent_area_id ?? null) !== parentAreaId ||
          !namesMatch(existing.name, areaName))
      ) {
        issues.push({
          rowNumber: row.rowNumber,
          field: "external id",
          value: externalId,
          code: "conflict",
          message: `Row ${row.rowNumber}: external id "${externalId}" already belongs to a different area/location.`,
        });
        continue;
      }
    }

    const wasExisting = Boolean(
      existing && options.areas.some((area) => area.id === existing.id),
    );
    const areaId = existing?.id ?? createId();

    if (externalId) {
      const owner = externalIdOwner.get(normalizeKey(externalId));
      if (owner && owner !== areaId) {
        issues.push({
          rowNumber: row.rowNumber,
          field: "external id",
          value: externalId,
          code: "duplicateExternalId",
          message: `Row ${row.rowNumber}: duplicate external id "${externalId}".`,
        });
        continue;
      }
      externalIdOwner.set(normalizeKey(externalId), areaId);
    }

    if (qrCode) {
      const owner = qrCodeOwner.get(normalizeKey(qrCode));
      if (owner && owner !== areaId) {
        issues.push({
          rowNumber: row.rowNumber,
          field: "QR code",
          value: qrCode,
          code: "duplicateQrCode",
          message: `Row ${row.rowNumber}: duplicate QR code "${qrCode}".`,
        });
        continue;
      }
      qrCodeOwner.set(normalizeKey(qrCode), areaId);
    }

    if (existing) {
      existing.name = areaName;
      existing.floor_id = parentAreaId ? null : floorId;
      existing.parent_area_id = parentAreaId;
      existing.external_id = externalId;
      existing.area_type = type;
      existing.qr_code = qrCode;
      if (!wasExisting) {
        existing.provisional = true;
      }
    } else {
      working.push({
        id: areaId,
        name: areaName,
        floor_id: parentAreaId ? null : floorId,
        parent_area_id: parentAreaId,
        external_id: externalId,
        area_type: type,
        qr_code: qrCode,
        provisional: true,
      });
    }

    items.push({
      rowNumber: row.rowNumber,
      action: wasExisting ? "update" : "create",
      name: areaName,
      externalId,
      type,
      qrCode,
      floorId,
      parentAreaId,
      areaId,
      locationLabel: row.location,
      parentChain,
    });
  }

  const leafIds = new Set(items.map((item) => item.areaId));
  const uniqueParents = createdParents.filter(
    (parent, index, list) =>
      !leafIds.has(parent.areaId) &&
      list.findIndex((item) => item.areaId === parent.areaId) === index,
  );

  return { items, createdParents: uniqueParents, issues };
}

export function splitLocationHierarchy(location: string): string[] {
  return normalizeWhitespace(location)
    .split(HIERARCHY_SPLIT)
    .map(normalizeWhitespace)
    .filter(Boolean);
}

export function resolveLocationPath(
  location: string,
  floors: AreaImportFloor[],
  buildingName: string,
  explicitName?: string,
):
  | {
      ok: true;
      floor: AreaImportFloor | null;
      parentNames: string[];
      leafName: string;
      floorPath: string | null;
    }
  | {
      ok: false;
      code: "unknownFloor" | "ambiguousFloor" | "ambiguousPath";
      message: string;
      floorLabel?: string;
      floorNumber?: number;
    } {
  const normalizedLocation = normalizeWhitespace(location);
  if (!normalizedLocation) {
    return {
      ok: false,
      code: "unknownFloor",
      message: "location is required.",
    };
  }

  const segments = splitLocationHierarchy(normalizedLocation);
  if (segments.length === 0) {
    return {
      ok: false,
      code: "unknownFloor",
      message: "location is required.",
    };
  }

  const nameHint = explicitName ? normalizeWhitespace(explicitName) : "";
  let leafName: string;
  let ancestorSegments: string[];

  if (nameHint && namesMatch(segments[segments.length - 1]!, nameHint)) {
    leafName = nameHint;
    ancestorSegments = segments.slice(0, -1);
  } else if (nameHint && segments.length === 1 && !/[<>]/.test(normalizedLocation)) {
    // Single segment location with a different explicit name: location is the
    // area name (ignore mismatched name column for hierarchy; prefer location).
    leafName = segments[0]!;
    ancestorSegments = [];
  } else if (nameHint) {
    // Location is a parent/floor path; name column is the leaf area.
    leafName = nameHint;
    ancestorSegments = segments;
  } else {
    leafName = segments[segments.length - 1]!;
    ancestorSegments = segments.slice(0, -1);
  }

  let floor: AreaImportFloor | null = null;
  let floorPath: string | null = null;
  const parentNames: string[] = [];

  for (const segment of ancestorSegments) {
    if (parentNames.length > 0) {
      // Floor references only apply before the first area name.
      parentNames.push(segment);
      continue;
    }

    const floorMatch = matchFloorSegment(segment, floors, buildingName);
    if (!floorMatch.ok) {
      return floorMatch;
    }
    if (floorMatch.floor) {
      floor = floorMatch.floor;
      floorPath = floorMatch.path;
      continue;
    }

    const hint = extractFloorHintFromSegment(segment, buildingName);
    if (hint) {
      const matchedFloor = floors.find((item) => item.number === hint.number);
      if (!matchedFloor) {
        return {
          ok: false,
          code: "unknownFloor",
          message: `Floor not found: ${hint.label} (${hint.number}).`,
          floorLabel: hint.label,
          floorNumber: hint.number,
        };
      }
      floor = matchedFloor;
      floorPath = hint.label;
      if (hint.remainder) {
        parentNames.push(hint.remainder);
      }
      continue;
    }

    parentNames.push(segment);
  }

  return {
    ok: true,
    floor,
    parentNames,
    leafName,
    floorPath,
  };
}

export type EquipmentLocationArea = {
  id: string;
  name: string;
  floor_id: string | null;
  parent_area_id: string | null;
};

/**
 * Resolve an equipment "area name" path to an existing floor and/or area.
 *
 * Hierarchy uses "<" or ">". When the last segment matches the equipment name,
 * it is treated as the equipment (not an area) and only the prefix is resolved.
 *
 * Examples:
 * - "קומה קרקע" → floor only
 * - "קומת קרקע - שטח חוץ < ארון גז בניין A" + name "ארון גז בניין A"
 *     → floor only (leaf is the equipment name)
 * - "קומה קרקע < לובי" + name "HVAC unit"
 *     → area "לובי" under that floor
 */
export function resolveExistingEquipmentLocation(
  location: string,
  floors: AreaImportFloor[],
  areas: EquipmentLocationArea[],
  buildingName: string,
  equipmentName = "",
):
  | { ok: true; floorId: string | null; areaId: string | null }
  | { ok: false; message: string } {
  const normalized = normalizeWhitespace(location);
  if (!normalized) {
    return { ok: true, floorId: null, areaId: null };
  }

  // Exports sometimes put the equipment name in the location column with no
  // real floor/area — treat that as unplaced.
  if (equipmentLeafMatches(normalized, equipmentName, buildingName)) {
    return { ok: true, floorId: null, areaId: null };
  }

  let segments = splitLocationHierarchy(normalized);
  if (segments.length === 0) {
    return { ok: true, floorId: null, areaId: null };
  }

  // Exports often encode "location < equipment name". Drop the leaf when it is
  // the equipment so we resolve the floor/area that comes before it.
  if (
    segments.length > 1 &&
    equipmentLeafMatches(
      segments[segments.length - 1]!,
      equipmentName,
      buildingName,
    )
  ) {
    segments = segments.slice(0, -1);
  }

  if (segments.length === 0) {
    return { ok: true, floorId: null, areaId: null };
  }

  const noLocation = {
    ok: true as const,
    floorId: null,
    areaId: null,
  };

  function unresolved(message: string):
    | { ok: true; floorId: null; areaId: null }
    | { ok: false; message: string } {
    // If nothing matched and the whole location string is the equipment name,
    // there is no area/floor placement.
    if (equipmentLeafMatches(normalized, equipmentName, buildingName)) {
      return noLocation;
    }
    return { ok: false, message };
  }

  const areaById = new Map(areas.map((area) => [area.id, area]));

  function resolveAreaFloor(
    area: EquipmentLocationArea,
    seen = new Set<string>(),
  ): string | null {
    if (area.floor_id) return area.floor_id;
    if (!area.parent_area_id || seen.has(area.id)) return null;
    seen.add(area.id);
    const parent = areaById.get(area.parent_area_id);
    return parent ? resolveAreaFloor(parent, seen) : null;
  }

  function areaNameCandidates(name: string): string[] {
    const trimmed = normalizeWhitespace(name);
    const candidates = new Set<string>([trimmed]);
    const building = normalizeWhitespace(buildingName);
    if (building) {
      const suffix = ` ${building}`;
      if (
        trimmed.length > suffix.length &&
        namesMatch(trimmed.slice(-suffix.length), suffix)
      ) {
        const stripped = normalizeWhitespace(
          trimmed.slice(0, -suffix.length),
        );
        if (stripped) candidates.add(stripped);
      }
      const prefix = `${building}${NAME_DELIMITER}`;
      if (
        trimmed.length > prefix.length &&
        namesMatch(trimmed.slice(0, prefix.length), prefix)
      ) {
        const stripped = normalizeWhitespace(trimmed.slice(prefix.length));
        if (stripped) candidates.add(stripped);
      }
    }
    return [...candidates];
  }

  function namesMatchAny(areaName: string, targetName: string) {
    return areaNameCandidates(targetName).some((target) =>
      namesMatch(areaName, target),
    );
  }

  function findDirectChildArea(
    name: string,
    scopedFloorId: string | null,
    parentAreaId: string | null,
  ) {
    return areas.find((area) => {
      if (!namesMatchAny(area.name, name)) return false;
      if (parentAreaId) {
        return area.parent_area_id === parentAreaId;
      }
      return (area.floor_id ?? null) === scopedFloorId && !area.parent_area_id;
    });
  }

  function findAreasOnFloor(name: string, scopedFloorId: string) {
    return areas.filter((area) => {
      if (!namesMatchAny(area.name, name)) return false;
      return resolveAreaFloor(area) === scopedFloorId;
    });
  }

  const firstSegment = segments[0]!;

  // Single segment: floor or area.
  if (segments.length === 1) {
    const floorMatch = matchFloorSegment(firstSegment, floors, buildingName);
    if (!floorMatch.ok) {
      return unresolved(floorMatch.message);
    }
    if (floorMatch.floor) {
      return { ok: true, floorId: floorMatch.floor.id, areaId: null };
    }

    const byName = areas.filter((area) =>
      namesMatchAny(area.name, firstSegment),
    );
    if (byName.length === 1) {
      const area = byName[0]!;
      return {
        ok: true,
        floorId: resolveAreaFloor(area),
        areaId: area.id,
      };
    }
    if (byName.length > 1) {
      return unresolved(`Ambiguous area match: ${firstSegment}`);
    }
    return unresolved(`Location not found: ${normalized}`);
  }

  // Multi-segment: first segment must be a floor.
  let floor: AreaImportFloor | null = null;
  const parentNames: string[] = [];

  const floorMatch = matchFloorSegment(firstSegment, floors, buildingName);
  if (!floorMatch.ok) {
    return unresolved(floorMatch.message);
  }
  if (floorMatch.floor) {
    floor = floorMatch.floor;
  } else {
    const hint = extractFloorHintFromSegment(firstSegment, buildingName);
    if (hint) {
      const matchedFloor = floors.find((item) => item.number === hint.number);
      if (!matchedFloor) {
        return unresolved(
          `Floor not found: ${hint.label} (${hint.number}).`,
        );
      }
      floor = matchedFloor;
      if (hint.remainder) parentNames.push(hint.remainder);
    }
  }

  if (!floor) {
    return unresolved(`Floor not found: ${firstSegment}`);
  }

  const leafName = segments[segments.length - 1]!;
  parentNames.push(...segments.slice(1, -1));

  let parentAreaId: string | null = null;
  for (const parentName of parentNames) {
    let parent = findDirectChildArea(parentName, floor.id, parentAreaId);
    if (!parent && parentAreaId == null) {
      const onFloor = findAreasOnFloor(parentName, floor.id);
      if (onFloor.length === 1) parent = onFloor[0]!;
      else if (onFloor.length > 1) {
        return unresolved(`Ambiguous area match: ${parentName}`);
      }
    }
    if (!parent) {
      return unresolved(`Area not found: ${parentName}`);
    }
    parentAreaId = parent.id;
  }

  const leafDirect = findDirectChildArea(leafName, floor.id, parentAreaId);
  if (leafDirect) {
    return {
      ok: true,
      floorId: resolveAreaFloor(leafDirect) ?? floor.id,
      areaId: leafDirect.id,
    };
  }

  if (!parentAreaId) {
    const onFloor = findAreasOnFloor(leafName, floor.id);
    if (onFloor.length === 1) {
      return { ok: true, floorId: floor.id, areaId: onFloor[0]!.id };
    }
    if (onFloor.length > 1) {
      return unresolved(`Ambiguous area match: ${leafName}`);
    }
  } else {
    const underParent = areas.filter((area) => {
      if (!namesMatchAny(area.name, leafName)) return false;
      let current: EquipmentLocationArea | undefined = area;
      const seen = new Set<string>();
      while (current?.parent_area_id) {
        if (current.parent_area_id === parentAreaId) return true;
        if (seen.has(current.id)) break;
        seen.add(current.id);
        current = areaById.get(current.parent_area_id);
      }
      return false;
    });
    if (underParent.length === 1) {
      return {
        ok: true,
        floorId: resolveAreaFloor(underParent[0]!) ?? floor.id,
        areaId: underParent[0]!.id,
      };
    }
    if (underParent.length > 1) {
      return unresolved(`Ambiguous area match: ${leafName}`);
    }

    // Leaf may still be the equipment name (not stripped due to slight mismatch)
    // or a non-area marker. Place under the deepest resolved parent area.
    if (equipmentLeafMatches(leafName, equipmentName, buildingName)) {
      return {
        ok: true,
        floorId: floor.id,
        areaId: parentAreaId,
      };
    }
  }

  // Multi-segment path resolved floor + parents but leaf is not an area — if the
  // leaf looks like the equipment, use the last parent area (or floor alone).
  if (
    segments.length >= 2 &&
    equipmentLeafMatches(leafName, equipmentName, buildingName)
  ) {
    return {
      ok: true,
      floorId: floor.id,
      areaId: parentAreaId,
    };
  }

  return unresolved(`Area not found: ${leafName}`);
}

/** True when a location leaf is the equipment name (not an area to resolve). */
function equipmentLeafMatches(
  leaf: string,
  equipmentName: string,
  buildingName: string,
): boolean {
  const name = normalizeWhitespace(equipmentName);
  if (!name) return false;
  if (namesMatch(leaf, name)) return true;

  const building = normalizeWhitespace(buildingName);
  if (!building) return false;

  const candidates = new Set<string>([name, leaf]);
  for (const value of [name, leaf]) {
    const suffix = ` ${building}`;
    if (
      value.length > suffix.length &&
      namesMatch(value.slice(-suffix.length), suffix)
    ) {
      const stripped = normalizeWhitespace(value.slice(0, -suffix.length));
      if (stripped) candidates.add(stripped);
    }
  }

  const list = [...candidates];
  return list.some((a, i) =>
    list.some((b, j) => i !== j && namesMatch(a, b)),
  );
}

function matchFloorSegment(
  segment: string,
  floors: AreaImportFloor[],
  buildingName: string,
):
  | { ok: true; floor: AreaImportFloor; path: string }
  | { ok: true; floor: null; path: null }
  | {
      ok: false;
      code: "ambiguousFloor";
      message: string;
    } {
  const matches: {
    floor: AreaImportFloor;
    path: string;
    kind: "name" | "numberLabel";
  }[] = [];
  for (const floor of floors) {
    for (const candidate of floorPathCandidateEntries(floor, buildingName)) {
      if (namesMatch(segment, candidate.path)) {
        matches.push({
          floor,
          path: candidate.path,
          kind: candidate.kind,
        });
      }
    }
  }

  if (matches.length === 0) {
    return { ok: true, floor: null, path: null };
  }

  // Prefer matches from the floor's actual name over generic number labels
  // (e.g. any floor numbered 0 matching "קומה קרקע"). Otherwise a floor like
  // "בניין B / קומת קרקע" (number 0) steals an exact "קומה קרקע" floor.
  const nameMatches = matches.filter((match) => match.kind === "name");
  const effective = nameMatches.length > 0 ? nameMatches : matches;

  const floorIds = new Set(effective.map((match) => match.floor.id));
  if (floorIds.size > 1) {
    // Prefer the floor whose number matches an explicit label in the segment
    // (e.g. "בניין B / קומת קרקע" → 0), so a differently-numbered floor that
    // happens to share the same name does not make the match ambiguous.
    const hint = parseFloorNumberHint(segment, buildingName);
    if (hint != null) {
      const byNumber = effective.filter((match) => match.floor.number === hint);
      const hintedIds = new Set(byNumber.map((match) => match.floor.id));
      if (hintedIds.size === 1) {
        const best = byNumber.sort((a, b) => b.path.length - a.path.length)[0]!;
        return { ok: true, floor: best.floor, path: best.path };
      }
    }

    return {
      ok: false,
      code: "ambiguousFloor",
      message: `Ambiguous floor match for location segment "${segment}".`,
    };
  }

  const best = effective.sort((a, b) => b.path.length - a.path.length)[0]!;
  return { ok: true, floor: best.floor, path: best.path };
}

export function floorPathCandidates(
  floor: AreaImportFloor,
  buildingName: string,
): string[] {
  return floorPathCandidateEntries(floor, buildingName).map(
    (entry) => entry.path,
  );
}

function floorPathCandidateEntries(
  floor: AreaImportFloor,
  buildingName: string,
): { path: string; kind: "name" | "numberLabel" }[] {
  const floorName = normalizeWhitespace(floor.name);
  const building = normalizeWhitespace(buildingName);
  const namePaths = new Set<string>();
  const numberPaths = new Set<string>();

  if (floorName) namePaths.add(floorName);

  const prefix = building ? `${building}${NAME_DELIMITER}` : "";
  if (prefix && floorName.toLowerCase().startsWith(prefix.toLowerCase())) {
    const stripped = normalizeWhitespace(floorName.slice(prefix.length));
    if (stripped) namePaths.add(stripped);
  } else if (building && floorName) {
    namePaths.add(`${building}${NAME_DELIMITER}${floorName}`);
  }

  // Also accept any " / "-suffix of the stored floor name
  // (e.g. "בניין A / קומת קרקע - שטח חוץ" → "קומת קרקע - שטח חוץ").
  if (floorName.includes(NAME_DELIMITER.trim())) {
    const parts = floorName
      .split(NAME_DELIMITER)
      .map(normalizeWhitespace)
      .filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) {
      namePaths.add(parts.slice(i).join(NAME_DELIMITER));
    }
  }

  for (const label of floorNumberLabels(floor.number)) {
    // Skip number labels that already appear as the floor's own name — those
    // stay classified as name matches.
    if (namePaths.has(label)) continue;
    numberPaths.add(label);
    if (building) {
      const buildingLabel = `${building}${NAME_DELIMITER}${label}`;
      if (!namePaths.has(buildingLabel)) numberPaths.add(buildingLabel);
    }
  }

  return [
    ...[...namePaths].filter(Boolean).map((path) => ({
      path,
      kind: "name" as const,
    })),
    ...[...numberPaths].filter(Boolean).map((path) => ({
      path,
      kind: "numberLabel" as const,
    })),
  ].sort((a, b) => b.path.length - a.path.length);
}

function floorNumberLabels(number: number): string[] {
  const labels = [
    `Floor ${number}`,
    `Level ${number}`,
    `קומה ${number}`,
  ];
  if (number === 0) {
    labels.push(
      "קומה קרקע",
      "קומת קרקע",
      "קרקע",
      "Ground floor",
      "Ground",
    );
  }
  if (number < 0) {
    labels.push(`מינוס ${Math.abs(number)}`);
    labels.push(`קומה מינוס ${Math.abs(number)}`);
  }
  return labels;
}

/**
 * Parse a floor number from a location segment label.
 * Supports: קומה קרקע → 0, מינוס N → -N, קומה N / Floor N / Level N.
 */
export function parseFloorNumberHint(
  segment: string,
  buildingName = "",
): number | null {
  let text = normalizeWhitespace(segment);
  if (!text) return null;

  const building = normalizeWhitespace(buildingName);
  if (building) {
    const prefix = `${building}${NAME_DELIMITER}`;
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
      text = normalizeWhitespace(text.slice(prefix.length));
    }
  }

  if (/^(?:קומה|קומת)\s+קרקע$/i.test(text) || /^קרקע$/i.test(text) || /^ground(?:\s+floor)?$/i.test(text)) {
    return 0;
  }

  let match =
    text.match(/^קומה\s+מינוס\s+(\d+)$/i) ??
    text.match(/^מינוס\s+(\d+)$/i);
  if (match) {
    return -Number.parseInt(match[1]!, 10);
  }

  match =
    text.match(/^קומה\s+(-?\d+)$/i) ??
    text.match(/^floor\s+(-?\d+)$/i) ??
    text.match(/^level\s+(-?\d+)$/i);
  if (match) {
    return Number.parseInt(match[1]!, 10);
  }

  return null;
}

/**
 * Extract a floor hint from a segment, optionally with a parent-area remainder
 * after " / " (e.g. "מינוס 1 / גרעין B" → floor -1, remainder "גרעין B").
 */
export function extractFloorHintFromSegment(
  segment: string,
  buildingName = "",
): { number: number; label: string; remainder: string | null } | null {
  const normalized = normalizeWhitespace(segment);
  if (!normalized) return null;

  const fullHint = parseFloorNumberHint(normalized, buildingName);
  if (fullHint != null) {
    return { number: fullHint, label: normalized, remainder: null };
  }

  const parts = normalized
    .split(NAME_DELIMITER)
    .map(normalizeWhitespace)
    .filter(Boolean);
  if (parts.length < 2) return null;

  const firstHint = parseFloorNumberHint(parts[0]!);
  if (firstHint != null) {
    return {
      number: firstHint,
      label: parts[0]!,
      remainder: parts.slice(1).join(NAME_DELIMITER),
    };
  }

  if (parts.length >= 3) {
    const twoPart = `${parts[0]}${NAME_DELIMITER}${parts[1]}`;
    const twoHint = parseFloorNumberHint(twoPart, buildingName);
    if (twoHint != null) {
      return {
        number: twoHint,
        label: twoPart,
        remainder: parts.slice(2).join(NAME_DELIMITER),
      };
    }
  }

  return null;
}

/** Unique missing floors from import issues, sorted by number. */
export function collectMissingFloors(
  issues: AreaImportIssue[],
): { number: number; label: string; rowNumbers: number[] }[] {
  const missing = new Map<number, { label: string; rowNumbers: Set<number> }>();
  for (const issue of issues) {
    if (
      issue.code === "unknownFloor" &&
      issue.floorNumber != null &&
      issue.floorLabel
    ) {
      const current = missing.get(issue.floorNumber) ?? {
        label: issue.floorLabel,
        rowNumbers: new Set<number>(),
      };
      current.rowNumbers.add(issue.rowNumber);
      missing.set(issue.floorNumber, current);
    }
  }
  return [...missing.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, item]) => ({
      number,
      label: item.label,
      rowNumbers: [...item.rowNumbers].sort((a, b) => a - b),
    }));
}

export function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function floorPathLabel(floor: AreaImportFloor, buildingName: string) {
  return floorPathCandidates(floor, buildingName)[0] ?? floor.name;
}

function namesMatch(a: string, b: string) {
  return normalizeKey(a) === normalizeKey(b);
}

function equalsIgnoreCase(a: string, b: string) {
  return normalizeKey(a) === normalizeKey(b);
}

function normalizeKey(value: string) {
  return normalizeWhitespace(value)
    .normalize("NFC")
    // Hyphen / dash variants (ASCII, en/em, minus, Hebrew maqaf, fullwidth).
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D\u05BE]/g, "-")
    // Treat "a-b", "a - b", and "a – b" as the same token boundary.
    .replace(/\s*-\s*/g, "-")
    // Zero-width and bidi marks that often appear in Excel/CSV copies.
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, "")
    .toLowerCase();
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replaceAll("_", " ");
}

function findHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  return headers.findIndex((header) => normalizedAliases.includes(header));
}

function escapeCsvValue(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function detectCsvDelimiterLocal(content: string): "," | ";" | "\t" {
  const firstLine = content.split(/\r\n|\n|\r/)[0] ?? "";
  let inQuotes = false;
  let commas = 0;
  let semicolons = 0;
  let tabs = 0;

  for (let i = 0; i < firstLine.length; i += 1) {
    const char = firstLine[i]!;
    if (char === '"') {
      if (inQuotes && firstLine[i + 1] === '"') {
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (inQuotes) continue;
    if (char === ",") commas += 1;
    else if (char === ";") semicolons += 1;
    else if (char === "\t") tabs += 1;
  }

  if (tabs > commas && tabs > semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

function parseCsvRows(
  content: string,
  delimiter: "," | ";" | "\t" = ",",
): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        // End the field only when the closing quote is followed by a delimiter,
        // newline, or EOF. A lone " mid-field (e.g. Hebrew gershayim in Visitt
        // headers like אתר - מס"ד / נסגר ע"י) is treated as a literal character.
        if (
          next === undefined ||
          next === delimiter ||
          next === "\n" ||
          next === "\r"
        ) {
          inQuotes = false;
        } else {
          cell += '"';
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.length === 0) {
        inQuotes = true;
      } else {
        cell += '"';
      }
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function parseSpreadsheetMlRows(content: string): string[][] | null {
  try {
    const doc = new DOMParser().parseFromString(content, "application/xml");
    if (doc.querySelector("parsererror")) return null;
    const rowNodes = [...doc.getElementsByTagName("Row")];
    if (rowNodes.length === 0) return null;
    return rowNodes.map((rowNode) => {
      const cells = [...rowNode.getElementsByTagName("Cell")];
      return cells.map((cell) => {
        const data = cell.getElementsByTagName("Data")[0];
        return (data?.textContent ?? cell.textContent ?? "").trim();
      });
    });
  } catch {
    return null;
  }
}
