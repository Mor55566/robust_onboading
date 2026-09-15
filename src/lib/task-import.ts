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
import type { TaskStatus, TaskUrgency } from "@/lib/types";

/** Headers matching Visitt export columns that map onto tasks (+ related tables). */
export const TASK_IMPORT_HEADERS = [
  "תיאור",
  "דחיפות",
  "סטאטוס",
  "תאריך יצירה",
  "תאריך אחרון לטיפול",
  "בניין",
  "מיקום",
  "קטגוריה",
  "תת קטגוריה",
  "מספר קריאה",
  "מדווח",
  "משתמש משויך",
  "תמונות הקריאה",
  "תמונות התיקון",
  "פתרון",
  "תאריך סגירה",
  'נסגר ע"י',
  "צ'קליסט",
] as const;

export type TaskImportChecklistItem = {
  label: string;
  isCompleted: boolean;
};

export type TaskImportRow = {
  rowNumber: number;
  description: string;
  urgency: TaskUrgency;
  status: TaskStatus;
  createdAt: string | null;
  dueAt: string | null;
  building: string;
  location: string;
  category: string;
  subcategory: string;
  callNumber: string;
  reporter: string;
  assignees: string[];
  imageUrls: string[];
  resolutionImageUrls: string[];
  resolution: string;
  resolvedAt: string | null;
  resolvedBy: string;
  checklistItems: TaskImportChecklistItem[] | null;
};

const SAMPLE_ROWS: Omit<TaskImportRow, "rowNumber">[] = [
  {
    description: "נא לטפל בנזילה בשירותי גברים",
    urgency: "medium",
    status: "open",
    createdAt: "02-08-2026 05:53:21",
    dueAt: "",
    building: "בניין B",
    location: "בניין B / קומה 4 < קומה 4 / גרעין / שירותים גברים",
    category: "אחזקת שבר",
    subcategory: "אינסטלציה",
    callNumber: "453055",
    reporter: "",
    assignees: [],
    imageUrls: [],
    resolutionImageUrls: [],
    resolution: "",
    resolvedAt: null,
    resolvedBy: "",
    checklistItems: null,
  },
  {
    description: "גוף תאורה לא תקין לובי מעליות",
    urgency: "high",
    status: "closed",
    createdAt: "30-07-2026 12:48:42",
    dueAt: "",
    building: "בניין A",
    location: "בניין A / קומה 1 < קומה 1 / גרעין",
    category: "אחזקת שבר",
    subcategory: "תאורה",
    callNumber: "452931",
    reporter: "",
    assignees: [],
    imageUrls: [],
    resolutionImageUrls: [],
    resolution: "הוחלף גוף התאורה",
    resolvedAt: "01-08-2026 10:15:00",
    resolvedBy: "",
    checklistItems: null,
  },
];

export function buildTasksCsvTemplate(): string {
  return buildCsvTemplate(
    [...TASK_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) => rowToCells(row)),
  );
}

export function buildTasksExcelTemplate(): string {
  return buildExcelTemplate(
    "Tasks",
    [...TASK_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row) =>
      rowToCells(row).map((value) => ({ value, type: "String" as const })),
    ),
  );
}

function rowToCells(row: Omit<TaskImportRow, "rowNumber">): string[] {
  return [
    row.description,
    row.urgency,
    row.status,
    row.createdAt ?? "",
    row.dueAt ?? "",
    row.building,
    row.location,
    row.category,
    row.subcategory,
    row.callNumber,
    row.reporter,
    row.assignees.join(";"),
    row.imageUrls.join("\n"),
    row.resolutionImageUrls.join("\n"),
    row.resolution,
    row.resolvedAt ?? "",
    row.resolvedBy,
    row.checklistItems?.map((item) => `${item.label}:${item.isCompleted ? "Yes" : "No"}`).join(";") ?? "",
  ];
}

export function parseTasksImportContent(
  content: string,
  fileName: string,
): { rows: TaskImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const descriptionIndex = findHeaderIndex(header, [
    "תיאור",
    "description",
  ]);
  if (descriptionIndex < 0) {
    return { error: "invalid", message: "__missing_description__" };
  }

  const urgencyIndex = findHeaderIndex(header, ["דחיפות", "urgency"]);
  const statusIndex = findHeaderIndex(header, ["סטאטוס", "סטטוס", "status"]);
  const createdAtIndex = findHeaderIndex(header, [
    "תאריך יצירה",
    "created at",
    "created_at",
  ]);
  const dueAtIndex = findHeaderIndex(header, [
    "תאריך אחרון לטיפול",
    "due at",
    "due_at",
  ]);
  const buildingIndex = findHeaderIndex(header, ["בניין", "building"]);
  const locationIndex = findHeaderIndex(header, ["מיקום", "location"]);
  const categoryIndex = findHeaderIndex(header, ["קטגוריה", "category"]);
  const subcategoryIndex = findHeaderIndex(header, [
    "תת קטגוריה",
    "subcategory",
    "sub category",
  ]);
  const callNumberIndex = findHeaderIndex(header, [
    "מספר קריאה",
    "call number",
    "call_number",
  ]);
  const reporterIndex = findHeaderIndex(header, [
    "מדווח",
    "reporter",
    "opened by",
  ]);
  const assigneesIndex = findHeaderIndex(header, [
    "משתמש משויך",
    "assignees",
    "assigned users",
  ]);
  const imagesIndex = findHeaderIndex(header, [
    "תמונות הקריאה",
    "images",
    "attachments",
  ]);
  const resolutionImagesIndex = findHeaderIndex(header, [
    "תמונות התיקון",
    "תמונות פתרון",
    "resolution images",
    "fix images",
    "solution images",
  ]);
  const resolutionIndex = findHeaderIndex(header, [
    "פתרון",
    "resolution",
    "solution",
  ]);
  const resolvedAtIndex = findHeaderIndex(header, [
    "תאריך סגירה",
    "resolved at",
    "resolved_at",
    "closed at",
  ]);
  const resolvedByIndex = findHeaderIndex(header, [
    'נסגר ע"י',
    "נסגר ע״י",
    "נסגר על ידי",
    "closed by",
    "resolved by",
  ]);
  const checklistIndex = findHeaderIndex(header, [
    "צ'קליסט",
    "צ׳קליסט",
    "checklist",
  ]);

  const rows: TaskImportRow[] = [];
  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const description = (cells[descriptionIndex] ?? "").trim();
    if (!description) {
      return {
        error: "invalidRow",
        message: `__row__:${rowNumber}`,
      };
    }

    const urgencyRaw =
      urgencyIndex >= 0 ? (cells[urgencyIndex] ?? "").trim() : "";
    const statusRaw = statusIndex >= 0 ? (cells[statusIndex] ?? "").trim() : "";
    const createdRaw =
      createdAtIndex >= 0 ? (cells[createdAtIndex] ?? "").trim() : "";
    const dueRaw = dueAtIndex >= 0 ? (cells[dueAtIndex] ?? "").trim() : "";
    const assigneesRaw =
      assigneesIndex >= 0 ? (cells[assigneesIndex] ?? "").trim() : "";
    const imagesRaw = imagesIndex >= 0 ? (cells[imagesIndex] ?? "").trim() : "";
    const resolutionImagesRaw =
      resolutionImagesIndex >= 0
        ? (cells[resolutionImagesIndex] ?? "").trim()
        : "";
    const resolvedAtRaw =
      resolvedAtIndex >= 0 ? (cells[resolvedAtIndex] ?? "").trim() : "";

    rows.push({
      rowNumber,
      description,
      urgency: parseUrgency(urgencyRaw),
      status: parseStatus(statusRaw),
      createdAt: parseImportDate(createdRaw),
      dueAt: parseImportDate(dueRaw),
      building: buildingIndex >= 0 ? (cells[buildingIndex] ?? "").trim() : "",
      location: locationIndex >= 0 ? (cells[locationIndex] ?? "").trim() : "",
      category: categoryIndex >= 0 ? (cells[categoryIndex] ?? "").trim() : "",
      subcategory:
        subcategoryIndex >= 0 ? (cells[subcategoryIndex] ?? "").trim() : "",
      callNumber:
        callNumberIndex >= 0 ? (cells[callNumberIndex] ?? "").trim() : "",
      reporter: reporterIndex >= 0 ? (cells[reporterIndex] ?? "").trim() : "",
      assignees: splitNames(assigneesRaw),
      imageUrls: splitUrls(imagesRaw),
      resolutionImageUrls: splitUrls(resolutionImagesRaw),
      resolution:
        resolutionIndex >= 0 ? (cells[resolutionIndex] ?? "").trim() : "",
      resolvedAt: parseImportDate(resolvedAtRaw),
      resolvedBy:
        resolvedByIndex >= 0 ? (cells[resolvedByIndex] ?? "").trim() : "",
      checklistItems:
        checklistIndex >= 0
          ? parseChecklistItems(cells[checklistIndex] ?? "")
          : null,
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

/** Parse `label:Yes;label:No`, preserving the source order. */
export function parseChecklistItems(value: string): TaskImportChecklistItem[] {
  if (!value.trim()) return [];

  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const separator = part.lastIndexOf(":");
      const status = separator >= 0 ? part.slice(separator + 1).trim().toLowerCase() : "";
      const hasStatus = status === "yes" || status === "no";
      return {
        label: (hasStatus ? part.slice(0, separator) : part).trim(),
        isCompleted: status === "yes",
      };
    })
    .filter((item) => item.label.length > 0);
}

export function parseUrgency(value: string): TaskUrgency {
  const normalized = normalizeLookup(value);
  if (!normalized) return "medium";
  if (
    normalized === "low" ||
    normalized === "נמוכה" ||
    normalized === "נמוך"
  ) {
    return "low";
  }
  if (
    normalized === "high" ||
    normalized === "גבוהה" ||
    normalized === "גבוה"
  ) {
    return "high";
  }
  if (
    normalized === "critical" ||
    normalized === "קריטית" ||
    normalized === "קריטי"
  ) {
    return "critical";
  }
  if (
    normalized === "medium" ||
    normalized === "בינונית" ||
    normalized === "בינוני"
  ) {
    return "medium";
  }
  return "medium";
}

export function parseStatus(value: string): TaskStatus {
  const normalized = normalizeLookup(value);
  if (!normalized) return "open";
  if (
    normalized === "open" ||
    normalized === "פתוח" ||
    normalized === "פתוחה"
  ) {
    return "open";
  }
  if (
    normalized === "in_work" ||
    normalized === "in work" ||
    normalized === "בטיפול"
  ) {
    return "in_work";
  }
  if (
    normalized === "closed" ||
    normalized === "סגור" ||
    normalized === "סגורה" ||
    normalized === "נסגר"
  ) {
    return "closed";
  }
  if (
    normalized === "canceled" ||
    normalized === "cancelled" ||
    normalized === "בוטל" ||
    normalized === "בוטלה"
  ) {
    return "canceled";
  }
  if (
    normalized === "paused" ||
    normalized === "מושהה" ||
    normalized === "מושהי"
  ) {
    return "paused";
  }
  return "open";
}

/** Parse Visitt-style `DD-MM-YYYY HH:mm:ss` (Israel local) or ISO dates. */
export function parseImportDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const visitt = trimmed.match(
    /^(\d{1,2})-(\d{1,2})-(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (visitt) {
    const day = Number(visitt[1]);
    const month = Number(visitt[2]);
    const year = Number(visitt[3]);
    const hour = Number(visitt[4] ?? 0);
    const minute = Number(visitt[5] ?? 0);
    const second = Number(visitt[6] ?? 0);
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    // Visitt exports wall-clock Israel time; store with +03:00 offset.
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export function splitNames(value: string): string[] {
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

export function splitUrls(value: string): string[] {
  if (!value.trim()) return [];
  return [
    ...new Set(
      value
        .split(/[\n\r,;]+/)
        .map((part) => part.trim())
        .filter((part) => /^https?:\/\//i.test(part)),
    ),
  ];
}

export function normalizeLookup(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveBuildingByName(
  value: string,
  buildings: TaskImportBuilding[],
  buildingByName: Map<string, TaskImportBuilding>,
): TaskImportBuilding | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = buildingByName.get(normalizeLookup(trimmed));
  if (direct) return direct;

  const withoutBuildingPrefix = trimmed.replace(/^בניין\s*/i, "").trim();
  if (withoutBuildingPrefix) {
    const bySuffix = buildingByName.get(normalizeLookup(withoutBuildingPrefix));
    if (bySuffix) return bySuffix;

    for (const building of buildings) {
      const name = normalizeLookup(building.name);
      if (
        name === normalizeLookup(withoutBuildingPrefix) ||
        name.endsWith(` ${normalizeLookup(withoutBuildingPrefix)}`)
      ) {
        return building;
      }
    }
  }

  return null;
}

export function guessAttachmentMeta(url: string): {
  file_name: string;
  mime_type: string;
} {
  try {
    const pathname = new URL(url).pathname;
    const base = pathname.split("/").pop() || "attachment";
    const file_name = decodeURIComponent(base.split("?")[0] || base) || "attachment";
    const lower = file_name.toLowerCase();
    if (lower.endsWith(".png")) return { file_name, mime_type: "image/png" };
    if (lower.endsWith(".gif")) return { file_name, mime_type: "image/gif" };
    if (lower.endsWith(".webp")) return { file_name, mime_type: "image/webp" };
    if (lower.endsWith(".pdf")) return { file_name, mime_type: "application/pdf" };
    if (lower.endsWith(".jpeg") || lower.endsWith(".jpg")) {
      return { file_name, mime_type: "image/jpeg" };
    }
    return { file_name, mime_type: "application/octet-stream" };
  } catch {
    return { file_name: "attachment", mime_type: "application/octet-stream" };
  }
}

export type TaskImportBuilding = {
  id: string;
  name: string;
};

export type TaskImportUser = {
  id: string;
  full_name: string;
  building_id: string | null;
};

export type TaskImportCategory = {
  id: string;
  name: string;
};

export type ResolvedTaskImportRow = {
  rowNumber: number;
  description: string;
  urgency: TaskUrgency;
  status: TaskStatus;
  createdAt: string | null;
  dueAt: string | null;
  callNumber: string | null;
  buildingId: string | null;
  floorId: string | null;
  areaId: string | null;
  categoryName: string | null;
  openedByUserId: string;
  openedByName: string | null;
  assigneeIds: string[];
  imageUrls: string[];
  resolutionImageUrls: string[];
  resolution: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  checklistItems: TaskImportChecklistItem[] | null;
};

export function resolveTaskImportRows(options: {
  rows: TaskImportRow[];
  buildings: TaskImportBuilding[];
  floorsByBuilding: Map<string, AreaImportFloor[]>;
  areasByBuilding: Map<string, EquipmentLocationArea[]>;
  users: TaskImportUser[];
  categories: TaskImportCategory[];
  fallbackOpenedByUserId: string;
}):
  | { ok: true; rows: ResolvedTaskImportRow[]; categoryNamesToCreate: string[] }
  | { ok: false; rowNumber: number; code: "building" | "location" | "user"; value: string } {
  const buildingByName = new Map(
    options.buildings.map((building) => [
      normalizeLookup(building.name),
      building,
    ]),
  );
  const categoryByName = new Map(
    options.categories.map((category) => [
      normalizeLookup(category.name),
      category,
    ]),
  );
  const usersByName = new Map<string, TaskImportUser[]>();
  for (const user of options.users) {
    const key = normalizeLookup(user.full_name);
    const list = usersByName.get(key) ?? [];
    list.push(user);
    usersByName.set(key, list);
  }

  const categoryNamesToCreate = new Set<string>();
  const resolved: ResolvedTaskImportRow[] = [];

  for (const row of options.rows) {
    let buildingId: string | null = null;
    if (row.building) {
      const building = resolveBuildingByName(
        row.building,
        options.buildings,
        buildingByName,
      );
      if (building) {
        buildingId = building.id;
      }
      // Soft-fail unknown building names; location inference may still match.
    }

    let floorId: string | null = null;
    let areaId: string | null = null;
    if (row.location) {
      if (!buildingId) {
        // Try to infer building from location prefix against known building names.
        for (const building of options.buildings) {
          const floors = options.floorsByBuilding.get(building.id) ?? [];
          const areas = options.areasByBuilding.get(building.id) ?? [];
          const location = resolveExistingEquipmentLocation(
            row.location,
            floors,
            areas,
            building.name,
          );
          if (location.ok && (location.floorId || location.areaId)) {
            buildingId = building.id;
            floorId = location.floorId;
            areaId = location.areaId;
            break;
          }
        }
        if (!buildingId) {
          // Soft-fail: create the task without a resolved location.
        }
      } else {
        const floors = options.floorsByBuilding.get(buildingId) ?? [];
        const areas = options.areasByBuilding.get(buildingId) ?? [];
        const buildingName =
          options.buildings.find((b) => b.id === buildingId)?.name ?? "";
        const location = resolveExistingEquipmentLocation(
          row.location,
          floors,
          areas,
          buildingName,
        );
        if (location.ok) {
          floorId = location.floorId;
          areaId = location.areaId;
        }
        // Soft-fail: still create the task if the location path is unknown.
      }
    }

    const subcategoryKey = row.subcategory
      ? normalizeLookup(row.subcategory)
      : "";
    const categoryKey = row.category ? normalizeLookup(row.category) : "";
    let resolvedCategoryName: string | null = null;
    if (subcategoryKey && categoryByName.has(subcategoryKey)) {
      resolvedCategoryName = row.subcategory.trim();
    } else if (categoryKey && categoryByName.has(categoryKey)) {
      resolvedCategoryName = row.category.trim();
    } else if (row.subcategory.trim()) {
      resolvedCategoryName = row.subcategory.trim();
      categoryNamesToCreate.add(resolvedCategoryName);
    } else if (row.category.trim()) {
      resolvedCategoryName = row.category.trim();
      categoryNamesToCreate.add(resolvedCategoryName);
    }

    function pickUser(name: string): TaskImportUser | null {
      const matches = usersByName.get(normalizeLookup(name));
      if (!matches || matches.length === 0) return null;
      if (buildingId) {
        const inBuilding = matches.find((u) => u.building_id === buildingId);
        if (inBuilding) return inBuilding;
      }
      return matches[0] ?? null;
    }

    let openedByUserId = options.fallbackOpenedByUserId;
    const openedByName: string | null = row.reporter.trim() || null;
    if (row.reporter) {
      // Reporter names sometimes include notes like "(ממשימה)".
      const reporterName = row.reporter.replace(/\([^)]*\)/g, "").trim();
      const reporter = pickUser(reporterName) ?? pickUser(row.reporter);
      if (reporter) {
        openedByUserId = reporter.id;
      }
    }

    // Floor-less imports still need a building association via the opener so
    // they appear in that building's open-tasks list.
    if (buildingId && openedByUserId === options.fallbackOpenedByUserId) {
      const buildingOpener = options.users.find(
        (candidate) => candidate.building_id === buildingId,
      );
      if (buildingOpener) {
        openedByUserId = buildingOpener.id;
      }
    }

    const assigneeIds: string[] = [];
    for (const name of row.assignees) {
      const assignee = pickUser(name);
      if (assignee && !assigneeIds.includes(assignee.id)) {
        assigneeIds.push(assignee.id);
      }
      // Soft-skip unknown assignee names so the rest of the row still imports.
    }

    let resolvedByUserId: string | null = null;
    if (row.resolvedBy) {
      const resolvedByName = row.resolvedBy.replace(/\([^)]*\)/g, "").trim();
      const resolver =
        pickUser(resolvedByName) ?? pickUser(row.resolvedBy);
      if (resolver) {
        resolvedByUserId = resolver.id;
      }
    }

    resolved.push({
      rowNumber: row.rowNumber,
      description: row.description,
      urgency: row.urgency,
      status: row.status,
      createdAt: row.createdAt,
      dueAt: row.dueAt,
      callNumber: row.callNumber.trim() || null,
      buildingId,
      floorId,
      areaId,
      categoryName: resolvedCategoryName,
      openedByUserId,
      openedByName,
      assigneeIds,
      imageUrls: row.imageUrls,
      resolutionImageUrls: row.resolutionImageUrls,
      resolution: row.resolution.trim() || null,
      resolvedAt: row.resolvedAt,
      resolvedByUserId,
      checklistItems: row.checklistItems,
    });
  }

  return {
    ok: true,
    rows: resolved,
    categoryNamesToCreate: [...categoryNamesToCreate],
  };
}
