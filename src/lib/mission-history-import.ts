import {
  resolveExistingEquipmentLocation,
  type AreaImportFloor,
  type EquipmentLocationArea,
} from "@/lib/area-import";
import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";
import {
  normalizeLookup,
  parseImportDate,
  splitUrls,
  type TaskImportBuilding,
} from "@/lib/task-import";
import type { TaskStatus } from "@/lib/types";

/** Headers matching the Visitt "mission history" export columns. */
export const MISSION_HISTORY_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "קישור",
  "משימה",
  "נכס",
  "אזור",
  "סטאטוס",
  "תדירות",
  "בניינים",
  "כתובות בניין",
  "אתרים",
  "משתמש משויך",
  "קטגוריה",
  "נסגר ב",
  "בוצע על ידי",
  "הערה",
  "תאריך יעד מקורי",
  "תאריך יעד מעודכן",
  "סיבה להשלמה באיחור",
  "נפתח בשנית ע״י",
  "זמן פתיחה מחדש",
  "קריאות",
  "מספר קריאות",
  "שעות עבודה",
  "שעות עבודה משוערות",
  "תמונות",
  "בדיקות",
  "עורכים",
] as const;

/** Headers matching the Visitt "open missions" export columns. */
export const OPEN_MISSIONS_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "שם",
  "נכס",
  "תדירות",
  "בניינים",
  "כתובות בניין",
  "מיקומים",
  "משתמש משויך",
  "קטגוריה",
  "תאריך התחלה",
  "סטאטוס",
  "תאריך יעד מקורי",
  "תאריך יעד מעודכן",
  "נפתח בשנית ע״י",
  "זמן פתיחה מחדש",
] as const;

export type MissionHistoryChecklistItemType =
  | "checklist"
  | "text"
  | "number"
  | "options";

export type MissionHistoryChecklistItem = {
  location: string | null;
  sortOrder: number;
  label: string;
  itemType: MissionHistoryChecklistItemType;
  rawValue: string;
  answerValue: string | null;
  isCompleted: boolean;
  numberUnit: string | null;
  options: string[];
};

export type MissionHistoryImportRow = {
  rowNumber: number;
  externalId: string;
  title: string;
  statusRaw: string;
  status: TaskStatus;
  buildingsRaw: string[];
  categoryRaw: string;
  assignedUserRaw: string;
  closedAt: string | null;
  resolvedByNameRaw: string;
  note: string;
  dueAt: string | null;
  imageUrls: string[];
  checklistItems: MissionHistoryChecklistItem[];
  /** Open-missions export only: when the occurrence opened. */
  startAt?: string | null;
  /** Open-missions export only: "מיקומים" location paths, for placement. */
  locationsRaw?: string[];
};

/** Known closed-set status tokens mapped to a canonical option pair. */
const KNOWN_OPTION_PAIRS: Record<string, string[]> = {
  תקין: ["תקין", "לא תקין"],
  "לא תקין": ["תקין", "לא תקין"],
  כן: ["כן", "לא"],
  לא: ["כן", "לא"],
  בתוקף: ["בתוקף", "לא בתוקף"],
  "לא בתוקף": ["בתוקף", "לא בתוקף"],
};

/**
 * Longest label continuation before we suspect the parser mis-split an item.
 * The longest legitimate multi-line item observed in real exports (a 9-step
 * numbered inspection checklist) is ~350 chars.
 */
const MAX_ITEM_LABEL_LENGTH = 450;

function tryExtractTrailingValue(
  line: string,
): { label: string; value: string } | null {
  const colonIndex = line.lastIndexOf(":");
  if (colonIndex < 0) return null;
  const value = line.slice(colonIndex + 1).trim();
  if (!value || value.length > 40 || value.includes(":") || value.includes("\n")) {
    return null;
  }
  return { label: line.slice(0, colonIndex).trim(), value };
}

/**
 * Parse the free-text "בדיקות" export column. Format: a location-path line,
 * followed by one or more tab-prefixed "label: value" item lines. Some
 * items span multiple physical lines (continuation lines have no leading
 * tab) — only the last line ends with a short " : value" terminator.
 */
export function parseMissionHistoryChecklistBlob(
  blob: string,
): MissionHistoryChecklistItem[] {
  const items: MissionHistoryChecklistItem[] = [];
  let currentLocation: string | null = null;
  let pendingLines: string[] = [];
  let sortOrder = 0;

  function flush(trailing: { label: string; value: string }) {
    const priorLines = pendingLines.slice(0, -1);
    const label = [...priorLines, trailing.label]
      .filter((line) => line.trim().length > 0)
      .join("\n")
      .trim();
    if (label.length > MAX_ITEM_LABEL_LENGTH) {
      console.warn("mission-history-import: unusually long checklist label", {
        length: label.length,
        location: currentLocation,
      });
    }
    items.push({
      location: currentLocation,
      sortOrder: sortOrder++,
      label,
      rawValue: trailing.value,
      ...inferChecklistItemFromValue(trailing.value),
    });
    pendingLines = [];
  }

  for (const rawLine of blob.split("\n")) {
    if (!rawLine.trim()) continue;

    if (pendingLines.length === 0) {
      if (rawLine.startsWith("\t")) {
        pendingLines.push(rawLine.slice(1).trim());
      } else {
        currentLocation = rawLine.trim();
        continue;
      }
    } else {
      pendingLines.push(
        rawLine.startsWith("\t") ? rawLine.slice(1).trim() : rawLine.trim(),
      );
    }

    const last = pendingLines[pendingLines.length - 1]!;
    const trailing = tryExtractTrailingValue(last);
    if (trailing) flush(trailing);
  }

  if (pendingLines.length > 0) {
    items.push({
      location: currentLocation,
      sortOrder: sortOrder++,
      label: pendingLines.join("\n").trim(),
      rawValue: "",
      ...inferChecklistItemFromValue(""),
    });
  }

  return items;
}

function parseNumericValue(
  value: string,
): { numeric: string; unit: string | null } | null {
  const match = value.match(/^(-?\d+(?:[.,]\d+)?)\s*([א-ת]*)\s*$/);
  if (!match) return null;
  return {
    numeric: match[1]!.replace(",", "."),
    unit: match[2] ? match[2].trim() : null,
  };
}

/** An answered item (number, option, text) counts as done; "-" and "X" don't. */
export function inferChecklistItemFromValue(rawValue: string): {
  itemType: MissionHistoryChecklistItemType;
  answerValue: string | null;
  isCompleted: boolean;
  numberUnit: string | null;
  options: string[];
} {
  const value = rawValue.trim();

  if (!value || value === "-") {
    return {
      itemType: "text",
      answerValue: null,
      isCompleted: false,
      numberUnit: null,
      options: [],
    };
  }

  if (value === "V" || value === "✓") {
    return {
      itemType: "checklist",
      answerValue: null,
      isCompleted: true,
      numberUnit: null,
      options: [],
    };
  }

  // Visitt exports an unticked checklist item as "X".
  if (value === "X" || value === "x" || value === "✗") {
    return {
      itemType: "checklist",
      answerValue: null,
      isCompleted: false,
      numberUnit: null,
      options: [],
    };
  }

  const numeric = parseNumericValue(value);
  if (numeric) {
    return {
      itemType: "number",
      answerValue: numeric.numeric,
      isCompleted: true,
      numberUnit: numeric.unit,
      options: [],
    };
  }

  const optionPair = KNOWN_OPTION_PAIRS[value];
  if (optionPair) {
    return {
      itemType: "options",
      answerValue: value,
      isCompleted: true,
      numberUnit: null,
      options: optionPair,
    };
  }

  return {
    itemType: "text",
    answerValue: value,
    isCompleted: true,
    numberUnit: null,
    options: [],
  };
}

/** History rows are past occurrences, so they are always imported as closed. */
export function parseMissionHistoryStatus(): TaskStatus {
  return "closed";
}

function splitList(value: string): string[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(/[;|,]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

const SAMPLE_ROWS: Omit<MissionHistoryImportRow, "rowNumber" | "status">[] = [
  {
    externalId: "6a6d0d0c0b4638f2e19d80b1",
    title: "בדיקת ציוד חירום",
    statusRaw: "בוצע",
    buildingsRaw: ["קומת קרקע"],
    categoryRaw: "אחזקת שבר",
    assignedUserRaw: "סרגיי גורינוב",
    closedAt: "30-08-2026 09:16:02",
    resolvedByNameRaw: "סרגיי גורינוב",
    note: "",
    dueAt: "31-08-2026 23:59:59",
    imageUrls: [],
    checklistItems: [],
  },
];

export function buildMissionHistoryCsvTemplate(): string {
  return buildCsvTemplate(
    [...MISSION_HISTORY_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row, index) => rowToCells(row, index + 1)),
  );
}

export function buildMissionHistoryExcelTemplate(): string {
  return buildExcelTemplate(
    "Mission history",
    [...MISSION_HISTORY_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row, index) =>
      rowToCells(row, index + 1).map((value) => ({
        value,
        type: "String" as const,
      })),
    ),
  );
}

function rowToCells(
  row: Omit<MissionHistoryImportRow, "rowNumber" | "status">,
  index: number,
): string[] {
  return [
    String(index),
    row.externalId,
    "",
    row.title,
    "",
    "",
    row.statusRaw,
    "",
    row.buildingsRaw.join(";"),
    "",
    "",
    row.assignedUserRaw,
    row.categoryRaw,
    row.closedAt ?? "",
    row.resolvedByNameRaw,
    row.note,
    row.dueAt ?? "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    row.imageUrls.join("\n"),
    "",
    "",
  ];
}

const OPEN_MISSIONS_SAMPLE_ROWS: Omit<MissionHistoryImportRow, "rowNumber" | "status">[] = [
  {
    externalId: "6abd789dc44fa4b61514aebc",
    title: "בדיקות במת מספריים",
    statusRaw: "פתוח",
    buildingsRaw: ["שטח משותף"],
    categoryRaw: "אחזקה מונעת",
    assignedUserRaw: "סרגיי גורינוב",
    closedAt: null,
    resolvedByNameRaw: "",
    note: "",
    dueAt: "31/12/26",
    imageUrls: [],
    checklistItems: [],
    startAt: "1/10/26",
    locationsRaw: ["מינוס 1 / גרעין A / חדר דחסנים / במת מספריים"],
  },
];

function openMissionRowToCells(
  row: Omit<MissionHistoryImportRow, "rowNumber" | "status">,
  index: number,
): string[] {
  return [
    String(index),
    row.externalId,
    row.title,
    "",
    "",
    row.buildingsRaw.join(";"),
    "",
    (row.locationsRaw ?? []).join(";"),
    row.assignedUserRaw,
    row.categoryRaw,
    row.startAt ?? "",
    row.statusRaw,
    row.dueAt ?? "",
    "",
    "",
    "",
  ];
}

export function buildOpenMissionsCsvTemplate(): string {
  return buildCsvTemplate(
    [...OPEN_MISSIONS_IMPORT_HEADERS],
    OPEN_MISSIONS_SAMPLE_ROWS.map((row, index) => openMissionRowToCells(row, index + 1)),
  );
}

export function buildOpenMissionsExcelTemplate(): string {
  return buildExcelTemplate(
    "Open missions",
    [...OPEN_MISSIONS_IMPORT_HEADERS],
    OPEN_MISSIONS_SAMPLE_ROWS.map((row, index) =>
      openMissionRowToCells(row, index + 1).map((value) => ({
        value,
        type: "String" as const,
      })),
    ),
  );
}

/**
 * The "מיקומים" cell lists each location as its breadcrumb chain
 * ("A < A / B < A / B / C"); only the deepest path of each entry is kept.
 */
function parseOpenMissionLocations(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[;\n]/)
        .map((entry) => entry.split("<").pop()!.trim())
        .filter(Boolean),
    ),
  ];
}

export function parseMissionHistoryImportContent(
  content: string,
  fileName: string,
): { rows: MissionHistoryImportRow[] } | { error: ImportParseError; message?: string } {
  return parseMissionRows(content, fileName, "closed");
}

/** Open (not yet done) occurrences from the Visitt open-missions export. */
export function parseOpenMissionsImportContent(
  content: string,
  fileName: string,
): { rows: MissionHistoryImportRow[] } | { error: ImportParseError; message?: string } {
  return parseMissionRows(content, fileName, "open");
}

function parseMissionRows(
  content: string,
  fileName: string,
  status: TaskStatus,
): { rows: MissionHistoryImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, ["מזהה", "external id", "external_id"]);
  const titleIndex = findHeaderIndex(header, ["משימה", "שם", "title", "name"]);
  const statusIndex = findHeaderIndex(header, ["סטאטוס", "סטטוס", "status"]);
  const buildingsIndex = findHeaderIndex(header, ["בניינים", "buildings", "building"]);
  const categoryIndex = findHeaderIndex(header, ["קטגוריה", "category"]);
  const assignedUserIndex = findHeaderIndex(header, ["משתמש משויך", "assignees", "assigned users"]);
  const closedAtIndex = findHeaderIndex(header, ["נסגר ב", "closed at", "resolved at"]);
  const resolvedByIndex = findHeaderIndex(header, ["בוצע על ידי", "resolved by", "done by"]);
  const noteIndex = findHeaderIndex(header, ["הערה", "note"]);
  const dueAtIndex = findHeaderIndex(header, ["תאריך יעד מקורי", "due at", "due_at"]);
  const updatedDueAtIndex = findHeaderIndex(header, ["תאריך יעד מעודכן", "updated due at"]);
  const startAtIndex = findHeaderIndex(header, ["תאריך התחלה", "start date", "start at"]);
  const locationsIndex = findHeaderIndex(header, ["מיקומים", "locations"]);
  const imagesIndex = findHeaderIndex(header, ["תמונות", "images"]);
  const checklistIndex = findHeaderIndex(header, ["בדיקות", "checklist"]);

  if (externalIdIndex < 0 || titleIndex < 0) {
    return { error: "invalid", message: "__missing_required__" };
  }

  const rows: MissionHistoryImportRow[] = [];
  const seenExternalIds = new Set<string>();
  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const externalId = (cells[externalIdIndex] ?? "").trim();
    const title = (cells[titleIndex] ?? "").trim();
    if (!externalId || !title) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }
    if (seenExternalIds.has(externalId)) {
      // Duplicate row for the same occurrence within one file — keep the first.
      continue;
    }
    seenExternalIds.add(externalId);

    const statusRaw = statusIndex >= 0 ? (cells[statusIndex] ?? "").trim() : "";
    const checklistRaw = checklistIndex >= 0 ? (cells[checklistIndex] ?? "") : "";

    rows.push({
      rowNumber,
      externalId,
      title,
      statusRaw,
      status: status === "closed" ? parseMissionHistoryStatus() : status,
      buildingsRaw: buildingsIndex >= 0 ? splitList(cells[buildingsIndex] ?? "") : [],
      categoryRaw: categoryIndex >= 0 ? (cells[categoryIndex] ?? "").trim() : "",
      assignedUserRaw: assignedUserIndex >= 0 ? (cells[assignedUserIndex] ?? "").trim() : "",
      closedAt: closedAtIndex >= 0 ? parseImportDate(cells[closedAtIndex] ?? "") : null,
      resolvedByNameRaw: resolvedByIndex >= 0 ? (cells[resolvedByIndex] ?? "").trim() : "",
      note: noteIndex >= 0 ? (cells[noteIndex] ?? "").trim() : "",
      // A rescheduled occurrence is due on its updated date.
      dueAt:
        (updatedDueAtIndex >= 0 ? parseImportDate(cells[updatedDueAtIndex] ?? "") : null) ??
        (dueAtIndex >= 0 ? parseImportDate(cells[dueAtIndex] ?? "") : null),
      imageUrls: imagesIndex >= 0 ? splitUrls(cells[imagesIndex] ?? "") : [],
      checklistItems: parseMissionHistoryChecklistBlob(checklistRaw),
      ...(status === "closed"
        ? {}
        : {
            startAt: startAtIndex >= 0 ? parseImportDate(cells[startAtIndex] ?? "") : null,
            locationsRaw:
              locationsIndex >= 0 ? parseOpenMissionLocations(cells[locationsIndex] ?? "") : [],
          }),
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

export type MissionHistoryTemplateMatch = {
  id: string;
  taskCategoryId: string | null;
  buildingId: string | null;
  floorId: string | null;
  areaId: string | null;
};

export type MissionHistoryClassification = "create" | "update" | "skip";

export type ResolvedMissionHistoryImportRow = MissionHistoryImportRow & {
  classification: MissionHistoryClassification;
  skipReason?: "noBuilding" | "externalIdConflict";
  /** True when no scheduled mission matched and the row is imported standalone. */
  unmatchedTemplate: boolean;
  templateTaskId: string | null;
  existingMissionId: string | null;
  buildingId: string | null;
  floorId: string | null;
  areaId: string | null;
  categoryId: string | null;
  resolvedByUserId: string | null;
  assignedUserId: string | null;
  checklistGroups: Array<{
    title: string;
    items: MissionHistoryChecklistItem[];
    locations: Array<{ buildingId: string; floorId: string | null; areaId: string | null }>;
  }>;
};

function resolveBuildingByName(
  value: string,
  buildings: TaskImportBuilding[],
): TaskImportBuilding | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = normalizeLookup(trimmed);
  const direct = buildings.find((building) => normalizeLookup(building.name) === normalized);
  if (direct) return direct;

  const withoutPrefix = trimmed.replace(/^בניין\s*/i, "").trim();
  if (withoutPrefix) {
    const normalizedSuffix = normalizeLookup(withoutPrefix);
    return (
      buildings.find(
        (building) =>
          normalizeLookup(building.name) === normalizedSuffix ||
          normalizeLookup(building.name).endsWith(` ${normalizedSuffix}`),
      ) ?? null
    );
  }
  return null;
}

/** Best-effort building/floor/area resolution for one checklist block's location text. */
function resolveChecklistLocation(
  locationText: string | null,
  buildings: TaskImportBuilding[],
  floorsByBuilding: Map<string, AreaImportFloor[]>,
  areasByBuilding: Map<string, EquipmentLocationArea[]>,
): { buildingId: string; floorId: string | null; areaId: string | null } | null {
  if (!locationText) return null;

  const directBuilding = resolveBuildingByName(locationText.split(/[/<]/)[0] ?? "", buildings);
  const candidates = directBuilding ? [directBuilding] : buildings;

  for (const building of candidates) {
    const floors = floorsByBuilding.get(building.id) ?? [];
    const areas = areasByBuilding.get(building.id) ?? [];
    const resolved = resolveExistingEquipmentLocation(locationText, floors, areas, building.name);
    if (resolved.ok && (resolved.floorId || resolved.areaId)) {
      return { buildingId: building.id, floorId: resolved.floorId, areaId: resolved.areaId };
    }
  }

  if (directBuilding) {
    return { buildingId: directBuilding.id, floorId: null, areaId: null };
  }
  return null;
}

/**
 * Where to place a history row that has no scheduled mission: its first
 * resolvable "מיקומים" path (open missions), else its "בניינים" building, else
 * its first resolvable check location, else the complex's only building.
 */
function resolveStandaloneLocation(
  row: MissionHistoryImportRow,
  checklistGroups: ResolvedMissionHistoryImportRow["checklistGroups"],
  buildings: TaskImportBuilding[],
  floorsByBuilding: Map<string, AreaImportFloor[]>,
  areasByBuilding: Map<string, EquipmentLocationArea[]>,
): { buildingId: string; floorId: string | null; areaId: string | null } | null {
  for (const location of row.locationsRaw ?? []) {
    const resolved = resolveChecklistLocation(
      location,
      buildings,
      floorsByBuilding,
      areasByBuilding,
    );
    if (resolved) return resolved;
  }
  for (const name of row.buildingsRaw) {
    const building = resolveBuildingByName(name, buildings);
    if (building) return { buildingId: building.id, floorId: null, areaId: null };
  }
  const fromChecks = checklistGroups.find((group) => group.locations.length > 0)?.locations[0];
  if (fromChecks) return fromChecks;
  if (buildings.length === 1) {
    return { buildingId: buildings[0]!.id, floorId: null, areaId: null };
  }
  return null;
}

export function classifyMissionHistoryImportRows(options: {
  rows: MissionHistoryImportRow[];
  existingMissionsByExternalId: Map<string, string>;
  existingExternalIdsAllTypes: Set<string>;
  templatesByNormalizedTitle: Map<string, MissionHistoryTemplateMatch>;
  buildings: TaskImportBuilding[];
  floorsByBuilding: Map<string, AreaImportFloor[]>;
  areasByBuilding: Map<string, EquipmentLocationArea[]>;
  usersByNormalizedName: Map<string, string>;
  categoriesByNormalizedName?: Map<string, string>;
}): ResolvedMissionHistoryImportRow[] {
  return options.rows.map((row) => {
    const existingMissionId = options.existingMissionsByExternalId.get(row.externalId) ?? null;
    const template = options.templatesByNormalizedTitle.get(normalizeLookup(row.title)) ?? null;

    const resolvedByUserId = row.resolvedByNameRaw
      ? (options.usersByNormalizedName.get(normalizeLookup(row.resolvedByNameRaw)) ?? null)
      : null;

    const groupsByLocation = new Map<string, MissionHistoryChecklistItem[]>();
    for (const item of row.checklistItems) {
      const key = item.location ?? "";
      const list = groupsByLocation.get(key) ?? [];
      list.push(item);
      groupsByLocation.set(key, list);
    }
    const checklistGroups = [...groupsByLocation].map(([location, items]) => {
      const resolvedLocation = resolveChecklistLocation(
        location || null,
        options.buildings,
        options.floorsByBuilding,
        options.areasByBuilding,
      );
      return {
        title: location || "בדיקות",
        items,
        locations: resolvedLocation ? [resolvedLocation] : [],
      };
    });

    // History is kept even when its scheduled mission was deleted or renamed:
    // the row is imported standalone, placed by its own building / check
    // locations so it still shows under the complex.
    const fallbackLocation = template
      ? null
      : resolveStandaloneLocation(
          row,
          checklistGroups,
          options.buildings,
          options.floorsByBuilding,
          options.areasByBuilding,
        );

    let classification: MissionHistoryClassification;
    let skipReason: ResolvedMissionHistoryImportRow["skipReason"];
    if (existingMissionId) {
      classification = "update";
    } else if (options.existingExternalIdsAllTypes.has(row.externalId)) {
      // Colliding with a non-mission row (e.g. a template or plain task) —
      // the global unique index on tasks.external_id would reject an insert.
      classification = "skip";
      skipReason = "externalIdConflict";
    } else if (template || fallbackLocation) {
      classification = "create";
    } else {
      classification = "skip";
      skipReason = "noBuilding";
    }

    const categoryId =
      template?.taskCategoryId ??
      (row.categoryRaw
        ? (options.categoriesByNormalizedName?.get(normalizeLookup(row.categoryRaw)) ?? null)
        : null);

    return {
      ...row,
      classification,
      skipReason,
      unmatchedTemplate: !template,
      templateTaskId: template?.id ?? null,
      existingMissionId,
      buildingId: template?.buildingId ?? fallbackLocation?.buildingId ?? null,
      floorId: template ? template.floorId : (fallbackLocation?.floorId ?? null),
      areaId: template ? template.areaId : (fallbackLocation?.areaId ?? null),
      categoryId,
      resolvedByUserId,
      assignedUserId: row.assignedUserRaw
        ? (options.usersByNormalizedName.get(normalizeLookup(row.assignedUserRaw)) ?? null)
        : null,
      checklistGroups,
    };
  });
}
