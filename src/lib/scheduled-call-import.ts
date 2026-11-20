import {
  buildCsvTemplate,
  buildExcelTemplate,
  findHeaderIndex,
  normalizeHeader,
  parseRawRows,
  type ImportParseError,
} from "@/lib/data-import";
import {
  applyNextRunToSchedule,
  tryParseMissionFrequency,
  type ParsedMissionSchedule,
} from "@/lib/mission-import";
import { parseImportDate, splitNames } from "@/lib/task-import";

/**
 * Scheduled calls ("תזמונים קבועים" in Visitt): a call template that opens a
 * new call every N days / weeks / months. In the app it is a `template-call`
 * task + a mission_schedules row, the table missions_cron reads to open both
 * missions and these calls (see with_robust_app src/lib/call-schedule.ts).
 */
export const SCHEDULED_CALL_IMPORT_HEADERS = [
  "#",
  "מזהה",
  "תיאור",
  "קטגוריה",
  "משתמש משויך",
  "מיקום",
  "דייר",
  "תזמון",
  "תחילת המשימה הבאה",
  "תאריך יצירה",
  'נוצר ע"י',
] as const;

export type ScheduledCallImportRow = {
  rowNumber: number;
  /** Visitt's id, kept in tasks.external_id so a re-upload updates the row. */
  externalId: string;
  description: string;
  category: string;
  assignees: string[];
  /** "בניין A", or a path such as "שטח משותף > מינוס 3 / חניון". */
  location: string;
  /** Resident the schedule is for - not carried over (calls templates have none). */
  resident: string;
  frequency: string;
  /** Next opening as YYYY-MM-DD (Israel date), or null. */
  nextRun: string | null;
  createdAt: string | null;
  createdBy: string;
};

const SAMPLE_ROWS: Omit<ScheduledCallImportRow, "rowNumber">[] = [
  {
    externalId: "69f9a44d15622cd846d28a0f",
    description: "ניקיון חדרים טכניים",
    category: "אחזקת שבר",
    assignees: ["ישראל ישראלי"],
    location: "בניין A",
    resident: "",
    frequency: "כל 3 חודשים",
    nextRun: "2027-02-09",
    createdAt: "2026-05-05T00:00:00+03:00",
    createdBy: "ישראל ישראלי",
  },
  {
    externalId: "698998142e3dad743a1e1949",
    description: "החלפת פילטר",
    category: "אחזקת שבר",
    assignees: [],
    location: "בניין B / חניון",
    resident: "",
    frequency: "כל 2 שבועות",
    nextRun: "2026-12-01",
    createdAt: "2026-02-09T00:00:00+03:00",
    createdBy: "",
  },
];

/** Visitt's day-first D/M/YY, as this report writes its dates. */
function formatDayFirst(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return `${day}/${month}/${String(year).slice(-2)}`;
}

function rowToCells(row: Omit<ScheduledCallImportRow, "rowNumber">, index: number): string[] {
  return [
    String(index + 1),
    row.externalId,
    row.description,
    row.category,
    row.assignees.join(", "),
    row.location,
    row.resident,
    row.frequency,
    formatDayFirst(row.nextRun),
    formatDayFirst(row.createdAt),
    row.createdBy,
  ];
}

export function buildScheduledCallsCsvTemplate(): string {
  return buildCsvTemplate([...SCHEDULED_CALL_IMPORT_HEADERS], SAMPLE_ROWS.map(rowToCells));
}

export function buildScheduledCallsExcelTemplate(): string {
  return buildExcelTemplate(
    "Scheduled calls",
    [...SCHEDULED_CALL_IMPORT_HEADERS],
    SAMPLE_ROWS.map((row, index) =>
      rowToCells(row, index).map((value) => ({ value, type: "String" as const })),
    ),
  );
}

/**
 * Visitt writes this report's schedule as "כל 3 חודשים" / "כל שבוע" ("every
 * ..."); the missions parser reads it without that word ("3 חודשים", "שבוע").
 */
export function parseScheduledCallFrequency(value: string): ParsedMissionSchedule | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withoutEvery = trimmed.replace(/^(?:כל|every)\s+/i, "");
  return tryParseMissionFrequency(withoutEvery) ?? tryParseMissionFrequency(trimmed);
}

/** Parse error message prefix; the rest is "<row>:<schedule value>". */
export const UNKNOWN_CALL_SCHEDULE_PREFIX = "__unknown_schedule__:";

export function parseScheduledCallsImportContent(
  content: string,
  fileName: string,
): { rows: ScheduledCallImportRow[] } | { error: ImportParseError; message?: string } {
  const raw = parseRawRows(content, fileName);
  if ("error" in raw) return raw;

  const header = raw.rows[0]!.map((cell) => normalizeHeader(cell));
  const descriptionIndex = findHeaderIndex(header, ["תיאור", "description"]);
  const frequencyIndex = findHeaderIndex(header, ["תזמון", "תדירות", "frequency", "schedule"]);
  if (descriptionIndex < 0 || frequencyIndex < 0) return { error: "invalid" };

  const externalIdIndex = findHeaderIndex(header, ["מזהה", "id", "external id"]);
  const categoryIndex = findHeaderIndex(header, ["קטגוריה", "category"]);
  const assigneesIndex = findHeaderIndex(header, ["משתמש משויך", "assignees"]);
  const locationIndex = findHeaderIndex(header, ["מיקום", "location"]);
  const residentIndex = findHeaderIndex(header, ["דייר", "resident"]);
  const nextRunIndex = findHeaderIndex(header, [
    "תחילת המשימה הבאה",
    "ריצה הבאה",
    "next run",
  ]);
  const createdAtIndex = findHeaderIndex(header, ["תאריך יצירה", "created at"]);
  const createdByIndex = findHeaderIndex(header, ['נוצר ע"י', "נוצר ע״י", "נוצר על ידי", "created by"]);

  const cell = (cells: string[], index: number) => (index >= 0 ? (cells[index] ?? "").trim() : "");
  const rows: ScheduledCallImportRow[] = [];

  for (const [offset, cells] of raw.rows.slice(1).entries()) {
    if (cells.every((value) => !value.trim())) continue;
    const rowNumber = offset + 2;
    const description = cell(cells, descriptionIndex);
    if (!description) return { error: "invalidRow", message: `__row__:${rowNumber}` };
    const frequency = cell(cells, frequencyIndex);
    if (!parseScheduledCallFrequency(frequency)) {
      return { error: "invalidRow", message: `${UNKNOWN_CALL_SCHEDULE_PREFIX}${rowNumber}:${frequency}` };
    }
    const nextRun = parseImportDate(cell(cells, nextRunIndex));
    rows.push({
      rowNumber,
      externalId: cell(cells, externalIdIndex),
      description,
      category: cell(cells, categoryIndex),
      assignees: splitNames(cell(cells, assigneesIndex)),
      location: cell(cells, locationIndex),
      resident: cell(cells, residentIndex),
      frequency,
      nextRun: nextRun ? nextRun.slice(0, 10) : null,
      createdAt: parseImportDate(cell(cells, createdAtIndex)),
      createdBy: cell(cells, createdByIndex),
    });
  }

  if (rows.length === 0) return { error: "empty" };
  return { rows };
}

/** The mission_schedules columns a scheduled call stores. */
export type CallScheduleColumns = {
  frequency: "day" | "month" | "year" | "custom";
  weekdays: number[] | null;
  intervalCount: number | null;
  intervalUnit: "day" | "month" | null;
  startDayOfMonth: number | null;
  startMonth: number | null;
};

const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/**
 * A scheduled call's schedule from the file's "תזמון" and next-run date, in
 * the shapes with_robust_app's call schedule form reads back:
 * - weekly         -> daily on that one weekday
 * - every N weeks  -> every N*7 days (mission_schedules_shape_check allows no
 *                     weekday on custom schedules)
 * - every N days / months, monthly, yearly -> as missions store them
 * Calls never auto-close, so there's no close window.
 *
 * `anchorAt` is the created_at to store so missions_cron's "every N" phase
 * lands on the file's next run (null = keep the file's creation date).
 */
export function scheduledCallScheduleFromImport(
  frequency: string,
  nextRun: string | null,
  createdAt: string | null,
  now: Date = new Date(),
): { schedule: CallScheduleColumns; anchorAt: string | null } | null {
  const parsed = parseScheduledCallFrequency(frequency);
  if (!parsed) return null;

  let base: ParsedMissionSchedule = parsed;
  if (parsed.frequency === "custom" && parsed.intervalUnit === "week") {
    base = { ...parsed, intervalUnit: "day", intervalCount: (parsed.intervalCount ?? 1) * 7, weekday: null };
  }
  const { schedule, anchorAt } = applyNextRunToSchedule(base, nextRun, createdAt, now);

  const empty: CallScheduleColumns = {
    frequency: "day",
    weekdays: null,
    intervalCount: null,
    intervalUnit: null,
    startDayOfMonth: null,
    startMonth: null,
  };
  switch (schedule.frequency) {
    case "day":
      return { schedule: { ...empty, weekdays: schedule.weekdays?.length ? schedule.weekdays : ALL_WEEKDAYS }, anchorAt };
    case "week":
      return { schedule: { ...empty, weekdays: [schedule.weekday ?? 0] }, anchorAt };
    case "month":
      return { schedule: { ...empty, frequency: "month", startDayOfMonth: schedule.startDayOfMonth ?? 1 }, anchorAt };
    case "year":
      return {
        schedule: {
          ...empty,
          frequency: "year",
          startDayOfMonth: schedule.startDayOfMonth ?? 1,
          startMonth: schedule.startMonth ?? 1,
        },
        anchorAt,
      };
    case "custom": {
      const count = Math.max(1, schedule.intervalCount ?? 1);
      if (schedule.intervalUnit === "month") {
        return {
          schedule: {
            ...empty,
            frequency: "custom",
            intervalCount: count,
            intervalUnit: "month",
            startDayOfMonth: schedule.startDayOfMonth ?? 1,
          },
          anchorAt,
        };
      }
      return { schedule: { ...empty, frequency: "custom", intervalCount: count, intervalUnit: "day" }, anchorAt };
    }
    default:
      return null;
  }
}
