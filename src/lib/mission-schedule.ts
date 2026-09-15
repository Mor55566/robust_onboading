import type { Dictionary } from "@/i18n/dictionaries/en";
import type {
  MissionSchedule,
  MissionScheduleFrequency,
  MissionScheduleIntervalUnit,
} from "@/lib/types";

/** 0=Sunday … 6=Saturday */
export const WEEKDAY_VALUES = [0, 1, 2, 3, 4, 5, 6] as const;

/** Default for daily missions: Sunday–Thursday */
export const DEFAULT_DAILY_WEEKDAYS: number[] = [0, 1, 2, 3, 4];

/** Hours of the day, 0-23, for the daily start/end time selects. */
export const HOUR_VALUES: number[] = Array.from({ length: 24 }, (_, i) => i);

/** Days of the month, 1-31, for the monthly/yearly start/end selects. */
export const DAY_OF_MONTH_VALUES: number[] = Array.from(
  { length: 31 },
  (_, i) => i + 1,
);

/** Months of the year, 1-12, for the yearly start-month select. */
export const MONTH_VALUES: number[] = Array.from({ length: 12 }, (_, i) => i + 1);

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export const SCHEDULE_FREQUENCIES: MissionScheduleFrequency[] = [
  "day",
  "week",
  "month",
  "year",
  "custom",
];

/** Sentinel value for the "open every" select's one-time option. Never persisted as a
 * MissionScheduleFrequency / mission_schedules row — a one-time mission is created directly
 * as a `mission` task with no template and no schedule. */
export const ONE_TIME_FREQUENCY = "once" as const;

export const SCHEDULE_INTERVAL_UNITS: MissionScheduleIntervalUnit[] = [
  "day",
  "week",
  "month",
];

export function isMissionScheduleFrequency(
  value: unknown,
): value is MissionScheduleFrequency {
  return (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year" ||
    value === "custom"
  );
}

export function isMissionScheduleIntervalUnit(
  value: unknown,
): value is MissionScheduleIntervalUnit {
  return value === "day" || value === "week" || value === "month";
}

export function parseWeekdays(raw: unknown): number[] | null {
  let values: unknown[] = [];
  if (Array.isArray(raw)) {
    values = raw;
  } else if (typeof raw === "string" && raw.length > 0) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) values = parsed;
      else values = raw.replace(/[{}]/g, "").split(",").filter(Boolean);
    } catch {
      values = raw.replace(/[{}]/g, "").split(",").filter(Boolean);
    }
  } else {
    return null;
  }

  const weekdays = [
    ...new Set(
      values
        .map((value) =>
          typeof value === "number" ? value : Number(String(value).trim()),
        )
        .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6),
    ),
  ].sort((a, b) => a - b);

  return weekdays.length > 0 ? weekdays : null;
}

function parseIntInRange(
  raw: unknown,
  min: number,
  max: number,
): number | null {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && raw.length > 0
        ? Number(raw)
        : null;
  return value != null && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/** Parses a Postgres `time` value (e.g. "09:00:00") into an hour (0-23). */
function parseHour(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= 0 && raw <= 23 ? raw : null;
  }
  if (typeof raw === "string" && raw.length > 0) {
    const hour = Number(raw.split(":")[0]);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
  }
  return null;
}

export function mapMissionSchedule(row: Record<string, unknown>): MissionSchedule | null {
  const frequency = row.schedule_frequency;
  if (!isMissionScheduleFrequency(frequency)) return null;

  const weekdayRaw = row.schedule_weekday;
  const weekday =
    typeof weekdayRaw === "number"
      ? weekdayRaw
      : typeof weekdayRaw === "string" && weekdayRaw.length > 0
        ? Number(weekdayRaw)
        : null;

  const intervalRaw = row.schedule_interval_count;
  const intervalCount =
    typeof intervalRaw === "number"
      ? intervalRaw
      : typeof intervalRaw === "string" && intervalRaw.length > 0
        ? Number(intervalRaw)
        : null;

  const intervalUnit = row.schedule_interval_unit;

  return {
    frequency,
    weekdays: parseWeekdays(row.schedule_weekdays),
    weekday:
      weekday != null && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6
        ? weekday
        : null,
    interval_count:
      intervalCount != null && Number.isFinite(intervalCount) && intervalCount > 0
        ? intervalCount
        : null,
    interval_unit: isMissionScheduleIntervalUnit(intervalUnit)
      ? intervalUnit
      : null,
    start_time: parseHour(row.schedule_start_time),
    end_time: parseHour(row.schedule_end_time),
    end_weekday: parseIntInRange(row.schedule_end_weekday, 0, 6),
    start_day_of_month: parseIntInRange(row.schedule_start_day_of_month, 1, 31),
    end_day_of_month: parseIntInRange(row.schedule_end_day_of_month, 1, 31),
    start_month: parseIntInRange(row.schedule_start_month, 1, 12),
    never_closes: row.schedule_never_closes === true,
    skip_holidays: row.schedule_skip_holidays === true,
  };
}

function weekdayShortLabels(dict: Dictionary): Record<number, string> {
  return {
    0: dict.tasks.weekdaySun,
    1: dict.tasks.weekdayMon,
    2: dict.tasks.weekdayTue,
    3: dict.tasks.weekdayWed,
    4: dict.tasks.weekdayThu,
    5: dict.tasks.weekdayFri,
    6: dict.tasks.weekdaySat,
  };
}

function formatWeekdayList(weekdays: number[], dict: Dictionary): string {
  const labels = weekdayShortLabels(dict);
  return weekdays.map((day) => labels[day] ?? String(day)).join(", ");
}

function monthLabels(dict: Dictionary): Record<number, string> {
  return {
    1: dict.tasks.monthJanuary,
    2: dict.tasks.monthFebruary,
    3: dict.tasks.monthMarch,
    4: dict.tasks.monthApril,
    5: dict.tasks.monthMay,
    6: dict.tasks.monthJune,
    7: dict.tasks.monthJuly,
    8: dict.tasks.monthAugust,
    9: dict.tasks.monthSeptember,
    10: dict.tasks.monthOctober,
    11: dict.tasks.monthNovember,
    12: dict.tasks.monthDecember,
  };
}

/** Short "opens–closes" window summary shown next to the frequency label. */
function formatScheduleWindow(
  schedule: MissionSchedule,
  dict: Dictionary,
): string {
  if (schedule.never_closes) return dict.tasks.neverCloses;

  const isWeekFrequency =
    schedule.frequency === "week" ||
    (schedule.frequency === "custom" && schedule.interval_unit === "week");
  const isMonthFrequency =
    schedule.frequency === "month" ||
    (schedule.frequency === "custom" && schedule.interval_unit === "month");

  if (schedule.frequency === "day") {
    const start =
      schedule.start_time != null
        ? formatHourLabel(schedule.start_time)
        : dict.tasks.startOfDay;
    const end =
      schedule.end_time != null
        ? formatHourLabel(schedule.end_time)
        : dict.tasks.endOfDay;
    return `${start}–${end}`;
  }

  if (isWeekFrequency) {
    const labels = weekdayShortLabels(dict);
    const start = labels[schedule.weekday ?? 0];
    const end = labels[schedule.end_weekday ?? 6];
    return `${start}–${end}`;
  }

  if (isMonthFrequency || schedule.frequency === "year") {
    const start = String(schedule.start_day_of_month ?? 1);
    const end =
      schedule.end_day_of_month != null
        ? String(schedule.end_day_of_month)
        : dict.tasks.endOfMonth;
    return `${start}–${end}`;
  }

  return "";
}

export function formatMissionSchedule(
  schedule: MissionSchedule | null | undefined,
  dict: Dictionary,
): string {
  if (!schedule) return "";

  const frequencyLabels: Record<MissionScheduleFrequency, string> = {
    day: dict.tasks.openEveryDay,
    week: dict.tasks.openEveryWeek,
    month: dict.tasks.openEveryMonth,
    year: dict.tasks.openEveryYear,
    custom: dict.tasks.openEveryCustom,
  };

  const window = formatScheduleWindow(schedule, dict);

  if (schedule.frequency === "day") {
    const days = schedule.weekdays?.length
      ? schedule.weekdays
      : DEFAULT_DAILY_WEEKDAYS;
    return `${frequencyLabels.day}: ${formatWeekdayList(days, dict)} (${window})`;
  }

  if (schedule.frequency === "week") {
    return `${frequencyLabels.week}: ${window}`;
  }

  if (schedule.frequency === "year") {
    const month = monthLabels(dict)[schedule.start_month ?? 1];
    return `${frequencyLabels.year}: ${month} (${window})`;
  }

  if (schedule.frequency === "custom") {
    const count = schedule.interval_count ?? 1;
    const unit = schedule.interval_unit ?? "day";
    const unitLabel =
      unit === "day"
        ? dict.tasks.openEveryCustomUnitDays
        : unit === "week"
          ? dict.tasks.openEveryCustomUnitWeeks
          : dict.tasks.openEveryCustomUnitMonths;
    const base = `${dict.tasks.openEveryCustomEvery} ${count} ${unitLabel}`;
    if (unit === "week" || unit === "month") {
      return `${base} (${window})`;
    }
    return base;
  }

  return `${frequencyLabels[schedule.frequency]} (${window})`;
}
