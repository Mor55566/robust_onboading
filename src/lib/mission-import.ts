import {
  resolveExistingEquipmentLocation,
  splitLocationHierarchy,
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
import { DEFAULT_DAILY_WEEKDAYS } from "@/lib/mission-schedule";
import type {
  MissionScheduleFrequency,
  MissionScheduleIntervalUnit,
} from "@/lib/types";
import {
  normalizeLookup,
  splitNames,
  type TaskImportBuilding,
  type TaskImportCategory,
  type TaskImportUser,
} from "@/lib/task-import";

/** Headers matching Visitt scheduled-missions export columns. */
export const MISSION_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "שם",
  "תדירות",
  "skip_on_holidays",
  "is_paused",
  "בניינים",
  "כתובות בניין",
  "קטגוריה",
  "משתמש משויך",
  "ריצה הבאה",
  "תאריך התחלה",
  "GPS",
  "תיאור",
  "בדיקות",
  "מיקומים",
  "שעות עבודה משוערות",
  "תאריך יצירה",
  'נוצר ע"י',
] as const;

export type MissionImportRow = {
  rowNumber: number;
  /** Stable id from the source system, or "" when the file has none. */
  externalId: string;
  /** Groups the file rows (one per checklist item) that form one mission. */
  groupKey?: string;
  title: string;
  frequency: string;
  skipHolidays: boolean;
  /** null when the file has no paused column (keep the current state). */
  isPaused: boolean | null;
  buildings: string[];
  category: string;
  assignees: string[];
  startDate: string | null;
  /** Next scheduled run as YYYY-MM-DD (Israel calendar date), or null. */
  nextRun?: string | null;
  description: string;
  locations: string[];
  createdAt: string | null;
  createdBy: string;
  checklistItems: MissionImportChecklistItem[];
};

export type MissionImportChecklistItem = {
  checklistTitle: string;
  sortOrder: number;
  label: string;
  itemType: "checklist" | "text" | "number" | "options" | "signature";
  fieldTypeOriginal: string;
  isRequired: boolean;
  numberUnit: string | null;
  numberRule: "any" | "between" | "less_than" | "greater_than" | null;
  numberMin: number | null;
  numberMax: number | null;
  options: string[];
  /**
   * Conditional field: the 0-based sortOrder of the question in the same
   * checklist that controls it, and the answers that make it visible.
   */
  showIfSortOrder?: number | null;
  showIfValues?: string[];
  /** Raw location paths belonging to this checklist row. */
  locations?: string[];
  /**
   * 1-based position of this row's location in Visitt's execution order (the
   * assignment's "סדר" step), when the exporter could read it.
   */
  locationOrder?: number | null;
};

function parseLocationOrder(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const order = Number(trimmed);
  return order > 0 ? order : null;
}

export type MissionImportEquipment = {
  id: string;
  name: string;
  building_id: string;
  floor_id: string | null;
  area_id: string | null;
};

function checklistItemIdentity(item: MissionImportChecklistItem): string {
  return JSON.stringify({
    sortOrder: item.sortOrder,
    label: item.label,
    itemType: item.itemType,
    fieldTypeOriginal: item.fieldTypeOriginal,
    isRequired: item.isRequired,
    numberUnit: item.numberUnit,
    numberRule: item.numberRule,
    numberMin: item.numberMin,
    numberMax: item.numberMax,
    options: item.options,
    showIfSortOrder: item.showIfSortOrder ?? null,
    showIfValues: item.showIfValues ?? [],
  });
}

/**
 * The browser exporter historically used each location path as the checklist
 * title and repeated every question once per location. Collapse that flattened
 * representation back into one checklist with unique questions; locations are
 * retained separately on the mission import row.
 */
export function collapseLocationChecklistItems(
  items: MissionImportChecklistItem[],
  locations: string[],
): MissionImportChecklistItem[] {
  if (items.length === 0 || locations.length === 0) return items;
  // An ordered export keeps one checklist per location on purpose: collapsing
  // would move the locations into checklist_locations, which has no order.
  if (items.some((item) => item.locationOrder != null)) return items;

  const locationTitles = new Set(locations.map((location) => normalizeLookup(location)));
  const isLocationFlattenedExport = items.every((item) =>
    locationTitles.has(normalizeLookup(item.checklistTitle)),
  );
  if (!isLocationFlattenedExport) return items;

  const itemsByLocation = new Map<string, MissionImportChecklistItem[]>();
  for (const item of items) {
    const key = normalizeLookup(item.checklistTitle);
    itemsByLocation.set(key, [...(itemsByLocation.get(key) ?? []), item]);
  }
  const signatures = [...itemsByLocation.values()].map((groupItems) =>
    groupItems.map(checklistItemIdentity).sort().join("\n"),
  );
  if (new Set(signatures).size > 1) {
    return items;
  }

  const uniqueItems = new Map<string, MissionImportChecklistItem>();
  for (const item of items) {
    const key = checklistItemIdentity(item);
    if (!uniqueItems.has(key)) {
      uniqueItems.set(key, {
        ...item,
        checklistTitle: "בדיקות",
        locations: [...locations],
      });
    }
  }
  return [...uniqueItems.values()];
}

/**
 * One checklist row per location, the way the main app saves a mission: a
 * Visitt card with five chillers becomes five rows that share the card's title
 * and checks (the edit form merges them back into one card), each with its own
 * location. Rows follow Visitt's "סדר" order when the file has it, otherwise
 * card order and then location order within the card.
 */
export function missionChecklistSlots(
  items: MissionImportChecklistItem[],
): Array<{
  title: string;
  location: string | null;
  items: MissionImportChecklistItem[];
}> {
  const slots = new Map<string, {
    title: string;
    location: string | null;
    items: MissionImportChecklistItem[];
    order: number;
    index: number;
  }>();
  for (const item of items) {
    const title = item.checklistTitle.trim() || "בדיקות";
    const locations = item.locations?.length ? item.locations : [null];
    for (const location of locations) {
      const key = `${title}\u0000${location ?? ""}`;
      let slot = slots.get(key);
      if (!slot) {
        slot = { title, location, items: [], order: Number.POSITIVE_INFINITY, index: slots.size };
        slots.set(key, slot);
      }
      if (item.locationOrder != null && slot.order === Number.POSITIVE_INFINITY) {
        slot.order = item.locationOrder;
      }
      slot.items.push(item);
    }
  }
  return [...slots.values()]
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(({ title, location, items: slotItems }) => ({ title, location, items: slotItems }));
}

export function groupMissionChecklistItems(
  items: MissionImportChecklistItem[],
): Array<{
  title: string;
  items: MissionImportChecklistItem[];
  locations: string[];
}> {
  const groups = new Map<string, MissionImportChecklistItem[]>();
  for (const item of items) {
    const title = item.checklistTitle.trim() || "בדיקות";
    const group = groups.get(title) ?? [];
    group.push(item);
    groups.set(title, group);
  }
  const groupOrder = (groupedItems: MissionImportChecklistItem[]) =>
    groupedItems.find((item) => item.locationOrder != null)?.locationOrder ??
    Number.POSITIVE_INFINITY;
  // Visitt's location order wins over file row order (a re-sorted CSV still
  // imports in execution order); groups without one keep their file order.
  return [...groups]
    .map(([title, groupedItems], index) => ({ title, groupedItems, index }))
    .sort(
      (left, right) =>
        groupOrder(left.groupedItems) - groupOrder(right.groupedItems) ||
        left.index - right.index,
    )
    .map(({ title, groupedItems }) => ({
      title,
      items: groupedItems,
      locations: [
        ...new Set(groupedItems.flatMap((item) => item.locations ?? [])),
      ],
    }));
}

export type ParsedMissionSchedule = {
  frequency: MissionScheduleFrequency;
  weekdays: number[] | null;
  weekday: number | null;
  intervalCount: number | null;
  intervalUnit: MissionScheduleIntervalUnit | null;
  /** Month/year/custom-month: day of month the mission opens (null = keep / 1st). */
  startDayOfMonth?: number | null;
  /** Year: month (1-12) the mission opens (null = keep / January). */
  startMonth?: number | null;
};

const SAMPLE_ROWS: Omit<MissionImportRow, "rowNumber">[] = [
  {
    externalId: "Afy8iZwboyHnC5HjM",
    title: "בדיקה של משאבת מתזים חשמלית",
    frequency: "שבועית",
    skipHolidays: false,
    isPaused: false,
    buildings: ["שטח משותף"],
    category: "אחזקה מונעת",
    assignees: ["סרגיי גורינוב"],
    startDate: "4/2/23",
    description: "",
    locations: ["מינוס 1 / משותף"],
    createdAt: "4/11/23, 9:08 AM",
    createdBy: "אורה סרטורי",
    checklistItems: [],
  },
  {
    externalId: "687dc7391e9ff49aa3c759b7",
    title: "בדיקה שנתית - אל פסק",
    frequency: "שנתית",
    skipHolidays: false,
    isPaused: false,
    buildings: ["בניין A", "בניין B", "קומת קרקע", "שטח משותף"],
    category: "אחזקה מונעת",
    assignees: ["סמיון  קיפניס", "סרגיי גורינוב"],
    startDate: "1/1/24",
    description: "",
    locations: ["בניין A / קומה 36", "בניין B / קומת קרקע"],
    createdAt: "7/21/25, 7:51 AM",
    createdBy: "אורה סרטורי",
    checklistItems: [],
  },
];

export function buildMissionsCsvTemplate(): string {
  return buildCsvTemplate(
    [...MISSION_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row, index) => rowToCells(row, index + 1)),
  );
}

export function buildMissionsExcelTemplate(): string {
  return buildExcelTemplate(
    "Scheduled missions",
    [...MISSION_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row, index) =>
      rowToCells(row, index + 1).map((value) => ({
        value,
        type: "String" as const,
      })),
    ),
  );
}

function rowToCells(
  row: Omit<MissionImportRow, "rowNumber">,
  index: number,
): string[] {
  return [
    String(index),
    row.externalId,
    row.title,
    row.frequency,
    row.skipHolidays ? "yes" : "no",
    row.isPaused ? "yes" : "no",
    row.buildings.join(";"),
    "",
    row.category,
    row.assignees.join(";"),
    "",
    row.startDate ?? "",
    "",
    row.description,
    "",
    row.locations.join(";"),
    "",
    row.createdAt ?? "",
    row.createdBy,
  ];
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

/** Parse Visitt-style `M/D/YY`, `M/D/YY, h:mm AM`, or ISO dates. */
export function parseMissionImportDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const us = trimmed.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i,
  );
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    let year = Number(us[3]);
    if (year < 100) year += 2000;
    let hour = Number(us[4] ?? 0);
    const minute = Number(us[5] ?? 0);
    const second = Number(us[6] ?? 0);
    const ampm = us[7]?.toUpperCase();
    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;
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
    return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}+03:00`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

/**
 * Parses the "next run" cell. The exporter writes YYYY-MM-DD; Visitt's own
 * CSV export ("ריצה הבאה") uses the same US M/D/YY format as its other dates.
 * Returns the Israel calendar date as YYYY-MM-DD, or null.
 */
export function parseMissionNextRun(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const parsed = parseMissionImportDate(trimmed);
  return parsed ? parsed.slice(0, 10) : null;
}

const MS_PER_DAY = 86_400_000;

function isoDateToDayIndex(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.floor(Date.UTC(year!, month! - 1, day!) / MS_PER_DAY);
}

function dayIndexToIsoDate(index: number): string {
  return new Date(index * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Israel (Asia/Jerusalem) calendar date of a timestamp, as YYYY-MM-DD. */
function jerusalemIsoDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * missions_cron has no "next run" column: it decides when a template opens
 * from mission_schedules (weekday / start_day_of_month / start_month) and, for
 * "every N" (custom) cadences, from the template's created_at date as the
 * phase anchor. This fills those fields so the cron's next opening lands on
 * Visitt's next run, without changing how the cron works.
 *
 * Returns the schedule to save, plus `anchorAt`: a created_at to store when
 * the custom cadence needs re-phasing (null = keep created_at as is). The
 * anchor is the latest in-phase date on or before the mission's real
 * creation date (or today), so created_at moves by less than one interval.
 */
export function applyNextRunToSchedule(
  schedule: ParsedMissionSchedule,
  nextRun: string | null | undefined,
  createdAt: string | null,
  now: Date = new Date(),
): { schedule: ParsedMissionSchedule; anchorAt: string | null } {
  if (!nextRun) return { schedule, anchorAt: null };

  const nextIdx = isoDateToDayIndex(nextRun);
  const [nextYear, nextMonth, nextDay] = nextRun.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  // 0=Sunday … 6=Saturday; epoch day 0 (1970-01-01) was a Thursday.
  const nextDow = (((nextIdx % 7) + 4) % 7 + 7) % 7;
  const n =
    schedule.intervalCount && schedule.intervalCount > 0
      ? schedule.intervalCount
      : 1;

  switch (schedule.frequency) {
    case "day":
      return { schedule, anchorAt: null };
    case "week":
      return { schedule: { ...schedule, weekday: nextDow }, anchorAt: null };
    case "month":
      return {
        schedule: { ...schedule, startDayOfMonth: nextDay },
        anchorAt: null,
      };
    case "year":
      return {
        schedule: { ...schedule, startDayOfMonth: nextDay, startMonth: nextMonth },
        anchorAt: null,
      };
    case "custom":
      break;
    default:
      return { schedule, anchorAt: null };
  }

  const reference = createdAt ? new Date(createdAt) : now;
  const referenceDate = Number.isNaN(reference.getTime())
    ? jerusalemIsoDate(now)
    : jerusalemIsoDate(reference);
  const referenceIdx = isoDateToDayIndex(referenceDate);

  let anchorDate: string;
  let nextSchedule: ParsedMissionSchedule = schedule;

  if (schedule.intervalUnit === "month") {
    nextSchedule = { ...schedule, startDayOfMonth: nextDay };
    const [refYear, refMonth] = referenceDate.split("-").map(Number) as [number, number];
    const nextMonthIdx = nextYear * 12 + (nextMonth - 1);
    const refMonthIdx = refYear * 12 + (refMonth - 1);
    // Latest month ≤ the reference month that is a whole number of
    // intervals away from the next run's month.
    const behind = (((nextMonthIdx - refMonthIdx) % n) + n) % n;
    const anchorMonthIdx = refMonthIdx - (behind === 0 ? 0 : n - behind);
    // The cron only reads the anchor's month; keep the reference day when it
    // stays in the reference month, else use the 1st.
    const anchorYear = Math.floor(anchorMonthIdx / 12);
    const anchorMonth = (anchorMonthIdx % 12) + 1;
    const day = anchorMonthIdx === refMonthIdx ? Number(referenceDate.slice(8, 10)) : 1;
    anchorDate = `${anchorYear}-${String(anchorMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  } else {
    const stepDays = schedule.intervalUnit === "week" ? n * 7 : n;
    if (schedule.intervalUnit === "week") {
      nextSchedule = { ...schedule, weekday: nextDow };
    }
    const behind = (((nextIdx - referenceIdx) % stepDays) + stepDays) % stepDays;
    anchorDate = dayIndexToIsoDate(
      referenceIdx - (behind === 0 ? 0 : stepDays - behind),
    );
  }

  // Already in phase: leave created_at untouched.
  if (createdAt && anchorDate === referenceDate) {
    return { schedule: nextSchedule, anchorAt: null };
  }
  // Noon keeps the Israel calendar date stable whatever the DST offset.
  return { schedule: nextSchedule, anchorAt: `${anchorDate}T12:00:00+03:00` };
}

const WEEKDAY_TOKEN_TO_NUMBER: Record<string, number> = {
  א: 0,
  sun: 0,
  sunday: 0,
  ראשון: 0,
  ב: 1,
  mon: 1,
  monday: 1,
  שני: 1,
  ג: 2,
  tue: 2,
  tuesday: 2,
  שלישי: 2,
  ד: 3,
  wed: 3,
  wednesday: 3,
  רביעי: 3,
  ה: 4,
  thu: 4,
  thursday: 4,
  חמישי: 4,
  ו: 5,
  fri: 5,
  friday: 5,
  שישי: 5,
  ש: 6,
  sat: 6,
  saturday: 6,
  שבת: 6,
};

function normalizeWeekdayToken(token: string): string {
  return normalizeLookup(token).replace(/['"׳`]/g, "");
}

function splitFrequencyValue(value: string): {
  base: string;
  weekdaySuffix: string | null;
} {
  const trimmed = value.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx >= 0) {
    return {
      base: trimmed.slice(0, colonIdx).trim(),
      weekdaySuffix: trimmed.slice(colonIdx + 1).trim() || null,
    };
  }

  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch) {
    return {
      base: parenMatch[1]!.trim(),
      weekdaySuffix: parenMatch[2]!.trim(),
    };
  }

  return { base: trimmed, weekdaySuffix: null };
}

export function parseWeekdayListFromImport(value: string): number[] | null {
  const cleaned = value.replace(/[()]/g, "").trim();
  if (!cleaned) return null;

  const weekdays = [
    ...new Set(
      cleaned
        .split(/[;|,]/)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((token) => WEEKDAY_TOKEN_TO_NUMBER[normalizeWeekdayToken(token)])
        .filter((day): day is number => day !== undefined),
    ),
  ].sort((a, b) => a - b);

  return weekdays.length > 0 ? weekdays : null;
}

export function parseMissionFrequency(value: string): ParsedMissionSchedule {
  const { base, weekdaySuffix } = splitFrequencyValue(value);
  const normalized = normalizeLookup(base);
  const parsedWeekdays = weekdaySuffix
    ? parseWeekdayListFromImport(weekdaySuffix)
    : null;

  if (!normalized) {
    return {
      frequency: "week",
      weekdays: null,
      weekday: 0,
      intervalCount: null,
      intervalUnit: null,
    };
  }

  if (
    normalized === "daily" ||
    normalized === "day" ||
    normalized === "יומית" ||
    normalized === "יום"
  ) {
    return {
      frequency: "day",
      weekdays: parsedWeekdays ?? [...DEFAULT_DAILY_WEEKDAYS],
      weekday: null,
      intervalCount: null,
      intervalUnit: null,
    };
  }

  if (
    normalized === "weekly" ||
    normalized === "week" ||
    normalized === "שבועית" ||
    normalized === "שבוע"
  ) {
    return {
      frequency: "week",
      weekdays: null,
      weekday: parsedWeekdays?.[0] ?? 0,
      intervalCount: null,
      intervalUnit: null,
    };
  }

  if (
    normalized === "monthly" ||
    normalized === "month" ||
    normalized === "חודשית" ||
    normalized === "חודש"
  ) {
    return {
      frequency: "month",
      weekdays: null,
      weekday: null,
      intervalCount: null,
      intervalUnit: null,
    };
  }

  if (
    normalized === "yearly" ||
    normalized === "year" ||
    normalized === "שנתית" ||
    normalized === "שנה"
  ) {
    return {
      frequency: "year",
      weekdays: null,
      weekday: null,
      intervalCount: null,
      intervalUnit: null,
    };
  }

  const biMonthly =
    normalized === "דו-חודשית" ||
    normalized === "דו חודשית" ||
    normalized === "bimonthly";
  if (biMonthly) {
    return {
      frequency: "custom",
      weekdays: null,
      weekday: null,
      intervalCount: 2,
      intervalUnit: "month",
    };
  }

  const quarterly =
    normalized === "תלת חודשית" ||
    normalized === "תלת-חודשית" ||
    normalized === "רבעונית" ||
    normalized === "quarterly";
  if (quarterly) {
    return {
      frequency: "custom",
      weekdays: null,
      weekday: null,
      intervalCount: 3,
      intervalUnit: "month",
    };
  }

  const customMatch = normalized.match(
    /^(\d+)\s*(day|days|week|weeks|month|months|יום|ימים|שבוע|שבועות|חודש|חודשים)$/,
  );
  if (customMatch) {
    const count = Number(customMatch[1]);
    const unitRaw = customMatch[2]!;
    const unit: MissionScheduleIntervalUnit =
      unitRaw.startsWith("week") || unitRaw.startsWith("שבוע")
        ? "week"
        : unitRaw.startsWith("month") || unitRaw.startsWith("חודש")
          ? "month"
          : "day";
    return {
      frequency: "custom",
      weekdays: null,
      weekday: unit === "week" ? 0 : null,
      intervalCount: count,
      intervalUnit: unit,
    };
  }

  return {
    frequency: "week",
    weekdays: null,
    weekday: 0,
    intervalCount: null,
    intervalUnit: null,
  };
}

/** Parse error message prefix; the rest lists the affected mission titles. */
export const MISSING_LOCATION_ORDER_PREFIX = "__missing_location_order__:";
/** Parse error message prefix; the rest lists the affected mission titles. */
export const MISSING_NEXT_RUN_PREFIX = "__missing_next_run__:";

export function parseMissionsImportContent(
  content: string,
  fileName: string,
):
  | { rows: MissionImportRow[] }
  | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const externalIdIndex = findHeaderIndex(header, [
    "מזהה",
    "external id",
    "external_id",
  ]);
  // source_index is just the row's position in the export (1, 2, 3…), so it
  // only groups rows within this file and is never stored as external_id.
  const sourceIndexIndex = findHeaderIndex(header, ["source_index", "source index"]);
  const titleIndex = findHeaderIndex(header, ["שם", "name", "title", "assignment_name", "assignment name"]);
  const frequencyIndex = findHeaderIndex(header, ["תדירות", "frequency"]);
  const skipHolidaysIndex = findHeaderIndex(header, [
    "skip_on_holidays", "skip_holidays", "לדלג בחגים", "דילוג בחגים",
  ]);
  const pausedIndex = findHeaderIndex(header, [
    "is_paused", "paused", "מושהית", "מושהה",
  ]);
  const buildingsIndex = findHeaderIndex(header, ["בניינים", "buildings", "building"]);
  const categoryIndex = findHeaderIndex(header, ["קטגוריה", "category"]);
  const assigneesIndex = findHeaderIndex(header, [
    "משתמש משויך",
    "assignees",
    "assigned users",
    "assigned_users",
  ]);
  const startDateIndex = findHeaderIndex(header, [
    "תאריך התחלה",
    "start date",
    "start_date",
  ]);
  const nextRunIndex = findHeaderIndex(header, [
    "next_run",
    "next run",
    "ריצה הבאה",
  ]);
  const descriptionIndex = findHeaderIndex(header, ["תיאור", "description"]);
  const locationsIndex = findHeaderIndex(header, ["מיקומים", "locations", "location"]);
  const createdAtIndex = findHeaderIndex(header, [
    "תאריך יצירה",
    "created at",
    "created_at",
  ]);
  const createdByIndex = findHeaderIndex(header, [
    'נוצר ע"י',
    "נוצר ע״י",
    "נוצר על ידי",
    "created by",
  ]);
  const checklistOrderIndex = findHeaderIndex(header, ["checklist_order", "checklist order"]);
  const checklistTitleIndex = findHeaderIndex(header, ["checklist_title", "checklist title"]);
  const locationOrderIndex = findHeaderIndex(header, ["location_order", "location order"]);
  const checklistNameIndex = findHeaderIndex(header, ["checklist_name", "checklist name"]);
  const fieldTypeIndex = findHeaderIndex(header, ["field_type", "field type"]);
  const fieldTypeOriginalIndex = findHeaderIndex(header, ["field_type_original", "field type original"]);
  const unitIndex = findHeaderIndex(header, ["unit"]);
  const numberConstraintIndex = findHeaderIndex(header, ["number_constraint_type", "number constraint type"]);
  const numberMinIndex = findHeaderIndex(header, ["number_min", "number min"]);
  const numberMaxIndex = findHeaderIndex(header, ["number_max", "number max"]);
  const optionsIndex = findHeaderIndex(header, ["options"]);
  const requiredIndex = findHeaderIndex(header, ["is_required", "required", "חובה"]);
  const conditionParentOrderIndex = findHeaderIndex(header, [
    "condition_parent_order",
    "condition parent order",
  ]);
  const conditionOptionIndex = findHeaderIndex(header, [
    "condition_option",
    "condition option",
  ]);

  if ((externalIdIndex < 0 && sourceIndexIndex < 0) || titleIndex < 0) {
    return { error: "invalid", message: "__missing_required__" };
  }

  const rows: MissionImportRow[] = [];
  const groupedRows = new Map<string, MissionImportRow>();
  for (let i = 1; i < raw.rows.length; i += 1) {
    const cells = raw.rows[i]!;
    if (cells.every((cell) => !cell.trim())) continue;

    const rowNumber = i + 1;
    const externalId =
      externalIdIndex >= 0 ? (cells[externalIdIndex] ?? "").trim() : "";
    const groupKey =
      externalId ||
      (sourceIndexIndex >= 0 ? (cells[sourceIndexIndex] ?? "").trim() : "");
    const title = (cells[titleIndex] ?? "").trim();
    if (!groupKey || !title) {
      return {
        error: "invalidRow",
        message: `__row__:${rowNumber}`,
      };
    }

    const holidayValue = (cells[skipHolidaysIndex] ?? "").trim().toLowerCase();
    const skipHolidays = ["yes", "true", "1", "כן", "מדולגת בחגים"].includes(holidayValue);
    if (!skipHolidays && !["", "no", "false", "0", "לא"].includes(holidayValue)) {
      return { error: "invalidRow", message: `__row__:${rowNumber}` };
    }

    let isPaused: boolean | null = null;
    if (pausedIndex >= 0) {
      const pausedValue = (cells[pausedIndex] ?? "").trim().toLowerCase();
      isPaused = ["yes", "true", "1", "כן", "מושהית"].includes(pausedValue);
      if (!isPaused && !["", "no", "false", "0", "לא"].includes(pausedValue)) {
        return { error: "invalidRow", message: `__row__:${rowNumber}` };
      }
    }

    const locationCell = locationsIndex >= 0 ? (cells[locationsIndex] ?? "").trim() : "";
    // An ordered export row holds exactly one location, and Visitt names may
    // contain commas ("קומות 26-34 , קומות 10…"), so it must not be split.
    const rowLocations =
      parseLocationOrder(locationOrderIndex >= 0 ? cells[locationOrderIndex] ?? "" : "") != null
        ? locationCell ? [locationCell] : []
        : splitList(locationCell);
    const checklistItems: MissionImportChecklistItem[] = [];
    if (checklistNameIndex >= 0 && (cells[checklistNameIndex] ?? "").trim()) {
      const rawFieldType = fieldTypeIndex >= 0 ? (cells[fieldTypeIndex] ?? "").trim().toLowerCase() : "checkbox";
      const fieldTypeOriginal = fieldTypeOriginalIndex >= 0 ? (cells[fieldTypeOriginalIndex] ?? "").trim() : rawFieldType;
      let itemType: MissionImportChecklistItem["itemType"] = "checklist";
      if (["number", "numeric", "מספר"].includes(rawFieldType)) itemType = "number";
      else if (["multi_select", "multi-select", "select", "options", "בחירה מרובה"].includes(rawFieldType)) itemType = "options";
      else if (["text", "textarea", "טקסט"].includes(rawFieldType)) itemType = "text";
      else if (["signature", "חתימה"].includes(rawFieldType)) itemType = "signature";

      const requiredValue = requiredIndex >= 0 ? (cells[requiredIndex] ?? "").trim().toLowerCase() : "";
      const isRequired = ["yes", "true", "1", "כן", "חובה"].includes(requiredValue);
      if (!isRequired && !["", "no", "false", "0", "לא"].includes(requiredValue)) {
        return { error: "invalidRow", message: `__row__:${rowNumber}` };
      }

      let parsedOptions: string[] = [];
      if (optionsIndex >= 0) {
        try {
          const value: unknown = JSON.parse(cells[optionsIndex] ?? "[]");
          if (Array.isArray(value)) parsedOptions = value.filter((option): option is string => typeof option === "string" && option.trim().length > 0).map((option) => option.trim());
        } catch {
          parsedOptions = splitList(cells[optionsIndex] ?? "");
        }
      }

      let constraintType = "";
      let constraintMin: number | null = null;
      let constraintMax: number | null = null;
      if (numberConstraintIndex >= 0 && (cells[numberConstraintIndex] ?? "").trim()) {
        try {
          const constraint = JSON.parse(cells[numberConstraintIndex] ?? "{}") as { type?: unknown; min?: unknown; max?: unknown };
          constraintType = typeof constraint.type === "string" ? constraint.type.toLowerCase() : "";
          constraintMin = constraint.min == null || constraint.min === "" ? null : Number(constraint.min);
          constraintMax = constraint.max == null || constraint.max === "" ? null : Number(constraint.max);
        } catch {
          constraintType = (cells[numberConstraintIndex] ?? "").trim().toLowerCase();
        }
      }
      const columnMin = numberMinIndex >= 0 && (cells[numberMinIndex] ?? "").trim() !== "" ? Number(cells[numberMinIndex]) : null;
      const columnMax = numberMaxIndex >= 0 && (cells[numberMaxIndex] ?? "").trim() !== "" ? Number(cells[numberMaxIndex]) : null;
      const numberMin = Number.isFinite(constraintMin) ? constraintMin : Number.isFinite(columnMin) ? columnMin : null;
      const numberMax = Number.isFinite(constraintMax) ? constraintMax : Number.isFinite(columnMax) ? columnMax : null;
      const numberRule: MissionImportChecklistItem["numberRule"] = itemType !== "number" ? null : constraintType === "between" ? "between" : ["greater_than", "greater-than", "min"].includes(constraintType) ? "greater_than" : ["less_than", "less-than", "max"].includes(constraintType) ? "less_than" : "any";

      // A conditional row names its controlling question by its 1-based
      // checklist_order; without a resolved parent the field is always shown.
      const parentOrderCell =
        conditionParentOrderIndex >= 0 ? (cells[conditionParentOrderIndex] ?? "").trim() : "";
      const conditionOption =
        conditionOptionIndex >= 0 ? (cells[conditionOptionIndex] ?? "").trim() : "";
      const showIfSortOrder =
        /^\d+$/.test(parentOrderCell) && Number(parentOrderCell) > 0 && conditionOption
          ? Number(parentOrderCell) - 1
          : null;

      checklistItems.push({
        checklistTitle:
          checklistTitleIndex >= 0
            ? (cells[checklistTitleIndex] ?? "").trim()
            : "",
        sortOrder: checklistOrderIndex >= 0 ? Math.max(0, Number(cells[checklistOrderIndex] ?? 1) - 1) : 0,
        label: (cells[checklistNameIndex] ?? "").trim(),
        itemType,
        fieldTypeOriginal,
        isRequired,
        numberUnit: itemType === "number" && unitIndex >= 0 ? (cells[unitIndex] ?? "").trim() || null : null,
        numberRule,
        numberMin: numberRule === "between" || numberRule === "greater_than" ? numberMin : null,
        numberMax: numberRule === "between" || numberRule === "less_than" ? numberMax : null,
        options: itemType === "options" ? parsedOptions : [],
        showIfSortOrder,
        showIfValues: showIfSortOrder != null ? [conditionOption] : [],
        locations: rowLocations,
        locationOrder: parseLocationOrder(
          locationOrderIndex >= 0 ? cells[locationOrderIndex] ?? "" : "",
        ),
      });
    }

    const parsedRow: MissionImportRow = {
      rowNumber,
      skipHolidays,
      isPaused,
      externalId,
      groupKey,
      title,
      frequency:
        frequencyIndex >= 0 ? (cells[frequencyIndex] ?? "").trim() : "",
      buildings:
        buildingsIndex >= 0
          ? splitList(cells[buildingsIndex] ?? "")
          : [],
      category:
        categoryIndex >= 0 ? (cells[categoryIndex] ?? "").trim() : "",
      assignees:
        assigneesIndex >= 0
          ? splitNames(cells[assigneesIndex] ?? "")
          : [],
      startDate:
        startDateIndex >= 0
          ? parseMissionImportDate(cells[startDateIndex] ?? "")
          : null,
      nextRun:
        nextRunIndex >= 0
          ? parseMissionNextRun(cells[nextRunIndex] ?? "")
          : null,
      description:
        descriptionIndex >= 0 ? (cells[descriptionIndex] ?? "").trim() : "",
      locations: rowLocations,
      createdAt:
        createdAtIndex >= 0
          ? parseMissionImportDate(cells[createdAtIndex] ?? "")
          : null,
      createdBy:
        createdByIndex >= 0 ? (cells[createdByIndex] ?? "").trim() : "",
      checklistItems,
    };

    const existing = groupedRows.get(groupKey);
    if (existing) {
      if (existing.skipHolidays !== skipHolidays || existing.isPaused !== isPaused) {
        return { error: "invalidRow", message: `__row__:${rowNumber}` };
      }
      existing.checklistItems.push(...checklistItems);
      existing.nextRun = existing.nextRun ?? parsedRow.nextRun;
      existing.locations = [
        ...new Set([...existing.locations, ...parsedRow.locations]),
      ];
      existing.assignees = [
        ...new Set([...existing.assignees, ...parsedRow.assignees]),
      ];
    } else {
      groupedRows.set(groupKey, parsedRow);
      rows.push(parsedRow);
    }
  }

  if (rows.length === 0) return { error: "empty" };

  // The exporter reads each assignment's location order from Visitt's "סדר"
  // step. When that step fails, it still writes the file but leaves
  // location_order empty, and the import would silently save the wrong order.
  // So a multi-location mission from the exporter must carry it on every row.
  if (checklistTitleIndex >= 0 && locationsIndex >= 0) {
    const unordered = rows.filter(
      (row) =>
        row.locations.length > 1 &&
        row.checklistItems.some(
          (item) => (item.locations?.length ?? 0) > 0 && item.locationOrder == null,
        ),
    );
    if (unordered.length > 0) {
      return {
        error: "invalid",
        message: `${MISSING_LOCATION_ORDER_PREFIX}${unordered
          .map((row) => row.title)
          .join(" | ")}`,
      };
    }
  }

  if (checklistTitleIndex >= 0) {
    // missions_cron's schedule is derived from the next run (see
    // applyNextRunToSchedule). An exporter file whose "ריצה הבאה" came out
    // empty or unreadable means Visitt's HTML changed: importing it would
    // silently put missions on the wrong day, so reject it. Paused missions
    // are exempt (Visitt may show no next run for them).
    const withoutNextRun = rows.filter(
      (row) => row.nextRun == null && row.isPaused !== true,
    );
    if (withoutNextRun.length > 0) {
      return {
        error: "invalid",
        message: `${MISSING_NEXT_RUN_PREFIX}${withoutNextRun
          .map((row) => row.title)
          .join(" | ")}`,
      };
    }
  }

  for (const row of rows) {
    row.checklistItems = collapseLocationChecklistItems(
      row.checklistItems,
      row.locations,
    );
  }
  return { rows };
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

function splitConcatenatedBuildingLocations(
  location: string,
  buildingNames: string[],
): string[] {
  const trimmedLocation = location.trim();
  if (!trimmedLocation) return [];

  const alternatives = [...new Set(buildingNames.map((name) => name.trim()).filter(Boolean))]
    .sort((left, right) => right.length - left.length)
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (alternatives.length === 0) return [trimmedLocation];

  const boundary = new RegExp(
    `([^\\s/<])(${alternatives.join("|")})(?=\\s*(?:/|<|$))`,
    "gi",
  );
  const separated = trimmedLocation.replace(boundary, "$1;$2");

  return separated.split(";").map((value) => value.trim()).filter(Boolean);
}

/** The building whose name starts a location path ("בניין B / קומה 35 < …"). */
function buildingNamedByLocation(
  location: string,
  buildings: TaskImportBuilding[],
): TaskImportBuilding | null {
  const normalizedLocation = normalizeLookup(location);
  let best: TaskImportBuilding | null = null;
  for (const building of buildings) {
    const name = normalizeLookup(building.name);
    if (!name || !normalizedLocation.startsWith(name)) continue;
    const next = normalizedLocation.charAt(name.length);
    if (next && !/[\s/<]/.test(next)) continue;
    if (!best || name.length > normalizeLookup(best.name).length) best = building;
  }
  return best;
}

function resolveMissionLocations(options: {
  locations: string[];
  buildingNames: string[];
  buildings: TaskImportBuilding[];
  buildingByName: Map<string, TaskImportBuilding>;
  floorsByBuilding: Map<string, AreaImportFloor[]>;
  areasByBuilding: Map<string, EquipmentLocationArea[]>;
  equipmentByBuilding?: Map<string, MissionImportEquipment[]>;
}): Array<{
  buildingId: string | null;
  floorId: string | null;
  areaId: string | null;
  equipmentId?: string | null;
}> {
  const buildingCandidates = options.buildingNames
    .map((name) =>
      resolveBuildingByName(name, options.buildings, options.buildingByName),
    )
    .filter((building): building is TaskImportBuilding => building != null);

  const buildingsToTry =
    buildingCandidates.length > 0 ? buildingCandidates : options.buildings;

  const resolvedLocations: Array<{
    buildingId: string;
    floorId: string | null;
    areaId: string | null;
    equipmentId?: string | null;
  }> = [];
  const seen = new Set<string>();

  const expandedLocations = options.locations.flatMap((location) =>
    splitConcatenatedBuildingLocations(
      location,
      options.buildings.map((building) => building.name),
    ),
  );

  function pushLocation(match: {
    buildingId: string;
    floorId: string | null;
    areaId: string | null;
    equipmentId?: string | null;
  }) {
    const key = `${match.buildingId}:${match.floorId ?? ""}:${match.areaId ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      resolvedLocations.push(match);
    }
  }

  // Exact match of one location path inside one building: the building
  // itself, an equipment leaf, or an existing floor/area path.
  function matchInBuilding(location: string, building: TaskImportBuilding) {
    if (normalizeLookup(location) === normalizeLookup(building.name)) {
      return { buildingId: building.id, floorId: null, areaId: null };
    }
    const locationLeaf = splitLocationHierarchy(location).at(-1) ?? "";
    const equipment = (options.equipmentByBuilding?.get(building.id) ?? []).find(
      (item) => normalizeLookup(item.name) === normalizeLookup(locationLeaf),
    );
    if (equipment) {
      return {
        buildingId: building.id,
        floorId: equipment.floor_id,
        areaId: equipment.area_id,
        equipmentId: equipment.id,
      };
    }
    const resolved = resolveExistingEquipmentLocation(
      location,
      options.floorsByBuilding.get(building.id) ?? [],
      options.areasByBuilding.get(building.id) ?? [],
      building.name,
    );
    if (resolved.ok && (resolved.floorId || resolved.areaId)) {
      return {
        buildingId: building.id,
        floorId: resolved.floorId,
        areaId: resolved.areaId,
      };
    }
    return null;
  }

  for (const location of expandedLocations) {
    // A path that starts with a building name ("בניין B / קומה 35 < …")
    // belongs to that building, whatever order the mission lists them in.
    const prefixBuilding = buildingNamedByLocation(location, options.buildings);
    const order = prefixBuilding
      ? [prefixBuilding, ...buildingsToTry.filter((b) => b.id !== prefixBuilding.id)]
      : buildingsToTry;

    // The full path first; when its tail is missing here (archived, renamed
    // or never imported), the deepest ancestor path that exists.
    const segments = splitLocationHierarchy(location);
    const candidates = [location];
    for (let length = segments.length - 1; length >= 1; length -= 1) {
      candidates.push(segments.slice(0, length).join(" < "));
    }

    let matched = false;
    for (const candidate of candidates) {
      for (const building of order) {
        const match = matchInBuilding(candidate, building);
        if (match) {
          // Equipment only counts for the full path: an ancestor's leaf is a
          // room, not this location's equipment.
          pushLocation(candidate === location ? match : { ...match, equipmentId: null });
          matched = true;
          break;
        }
      }
      if (matched) break;
    }

    if (!matched && prefixBuilding) {
      pushLocation({ buildingId: prefixBuilding.id, floorId: null, areaId: null });
    }
  }

  if (resolvedLocations.length > 0) return resolvedLocations;
  const fallbackBuilding = buildingCandidates[0] ?? null;
  return [{
    buildingId: fallbackBuilding?.id ?? null,
    floorId: null,
    areaId: null,
  }];
}

export type ResolvedMissionImportRow = {
  rowNumber: number;
  externalId: string;
  title: string;
  description: string;
  schedule: ParsedMissionSchedule;
  skipHolidays: boolean;
  isPaused: boolean | null;
  buildingId: string | null;
  floorId: string | null;
  areaId: string | null;
  locations: Array<{
    buildingId: string;
    floorId: string | null;
    areaId: string | null;
  }>;
  categoryName: string | null;
  openedByUserId: string;
  openedByName: string | null;
  assigneeIds: string[];
  startDate: string | null;
  createdAt: string | null;
  /** created_at to store so missions_cron's custom cadence lands on the next run (null = keep). */
  scheduleAnchorAt: string | null;
  checklistItems: MissionImportChecklistItem[];
  /** One checklist row per location (see missionChecklistSlots). */
  checklistGroups: Array<{
    title: string;
    items: MissionImportChecklistItem[];
    locations: Array<{
      buildingId: string;
      floorId: string | null;
      areaId: string | null;
      /** The equipment the Visitt location names, when it exists here. */
      equipmentId: string | null;
      /** The location path exactly as Visitt wrote it. */
      label: string | null;
    }>;
  }>;
};

export function resolveMissionImportRows(options: {
  rows: MissionImportRow[];
  buildings: TaskImportBuilding[];
  floorsByBuilding: Map<string, AreaImportFloor[]>;
  areasByBuilding: Map<string, EquipmentLocationArea[]>;
  equipmentByBuilding?: Map<string, MissionImportEquipment[]>;
  users: TaskImportUser[];
  categories: TaskImportCategory[];
  fallbackOpenedByUserId: string;
}):
  | { ok: true; rows: ResolvedMissionImportRow[]; categoryNamesToCreate: string[] }
  | { ok: false; rowNumber: number; code: "user"; value: string } {
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
  const resolved: ResolvedMissionImportRow[] = [];

  function pickUser(
    name: string,
    buildingId: string | null,
  ): TaskImportUser | null {
    const matches = usersByName.get(normalizeLookup(name));
    if (!matches || matches.length === 0) return null;
    if (buildingId) {
      const inBuilding = matches.find((user) => user.building_id === buildingId);
      if (inBuilding) return inBuilding;
    }
    return matches[0] ?? null;
  }

  for (const row of options.rows) {
    const locations = resolveMissionLocations({
      locations: row.locations,
      buildingNames: row.buildings,
      buildings: options.buildings,
      buildingByName,
      floorsByBuilding: options.floorsByBuilding,
      areasByBuilding: options.areasByBuilding,
      equipmentByBuilding: options.equipmentByBuilding,
    });
    const primaryLocation = locations[0] ?? {
      buildingId: null,
      floorId: null,
      areaId: null,
    };
    const checklistGroups = missionChecklistSlots(row.checklistItems).map((slot) => {
      const match = slot.location
        ? resolveMissionLocations({
            locations: [slot.location],
            buildingNames: row.buildings,
            buildings: options.buildings,
            buildingByName,
            floorsByBuilding: options.floorsByBuilding,
            areasByBuilding: options.areasByBuilding,
            equipmentByBuilding: options.equipmentByBuilding,
          })[0]
        : null;
      return {
        title: slot.title,
        items: slot.items,
        locations:
          slot.location && match?.buildingId
            ? [{
                buildingId: match.buildingId,
                floorId: match.floorId,
                areaId: match.areaId,
                equipmentId: match.equipmentId ?? null,
                label: slot.location,
              }]
            : [],
      };
    });

    const categoryKey = row.category ? normalizeLookup(row.category) : "";
    let resolvedCategoryName: string | null = null;
    if (categoryKey && categoryByName.has(categoryKey)) {
      resolvedCategoryName = row.category.trim();
    } else if (row.category.trim() && row.category.trim() !== "undefined") {
      resolvedCategoryName = row.category.trim();
      categoryNamesToCreate.add(resolvedCategoryName);
    }

    let openedByUserId = options.fallbackOpenedByUserId;
    const openedByName: string | null = row.createdBy.trim() || null;
    if (row.createdBy) {
      const creatorName = row.createdBy.replace(/\([^)]*\)/g, "").trim();
      const creator = pickUser(creatorName, primaryLocation.buildingId) ?? pickUser(row.createdBy, primaryLocation.buildingId);
      if (creator) {
        openedByUserId = creator.id;
      }
    }

    if (
      primaryLocation.buildingId &&
      openedByUserId === options.fallbackOpenedByUserId
    ) {
      const buildingOpener = options.users.find(
        (candidate) => candidate.building_id === primaryLocation.buildingId,
      );
      if (buildingOpener) {
        openedByUserId = buildingOpener.id;
      }
    }

    const assigneeIds: string[] = [];
    for (const name of row.assignees) {
      const assignee = pickUser(name, primaryLocation.buildingId);
      if (assignee && !assigneeIds.includes(assignee.id)) {
        assigneeIds.push(assignee.id);
      }
    }

    const { schedule, anchorAt: scheduleAnchorAt } = applyNextRunToSchedule(
      parseMissionFrequency(row.frequency),
      row.nextRun,
      row.createdAt,
    );

    resolved.push({
      rowNumber: row.rowNumber,
      externalId: row.externalId,
      title: row.title,
      description: row.description.trim() || row.title,
      schedule,
      skipHolidays: row.skipHolidays,
      isPaused: row.isPaused,
      buildingId: primaryLocation.buildingId,
      floorId: primaryLocation.floorId,
      areaId: primaryLocation.areaId,
      locations: locations.filter(
        (location): location is {
          buildingId: string;
          floorId: string | null;
          areaId: string | null;
        } => location.buildingId !== null,
      ),
      categoryName: resolvedCategoryName,
      openedByUserId,
      openedByName,
      assigneeIds,
      startDate: row.startDate,
      createdAt: row.createdAt,
      scheduleAnchorAt,
      checklistItems: [...row.checklistItems].sort((a, b) => a.sortOrder - b.sortOrder),
      checklistGroups,
    });
  }

  return {
    ok: true,
    rows: resolved,
    categoryNamesToCreate: [...categoryNamesToCreate],
  };
}
