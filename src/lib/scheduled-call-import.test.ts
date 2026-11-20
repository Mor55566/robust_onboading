import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScheduledCallsImportContent,
  scheduledCallScheduleFromImport,
  UNKNOWN_CALL_SCHEDULE_PREFIX,
} from "./scheduled-call-import";

// Visitt's "תזמונים קבועים" export, as received (dates are day-first D/M/YY).
const VISITT_EXPORT = [
  `"#","מזהה","תיאור","קטגוריה","משתמש משויך","מיקום","דייר","תזמון","תחילת המשימה הבאה","תאריך יצירה","נוצר ע""י"`,
  `1,"69f9a44d15622cd846d28a0f","ניקיון חדרים טכניים","אחזקת שבר","סלבה פיליפנקו, נדיה סובול","בניין A","","כל 3 חודשים","9/2/27","5/5/26","אורה סרטורי"`,
  `2,"69f9a44be3088c25a059dc7d","ניקיון חדרים טכניים","אחזקת שבר","נדיה סובול","בניין B","","כל 3 חודשים","10/2/27","5/5/26","אורה סרטורי"`,
  `3,"698998142e3dad743a1e1949","החלפת פילטר של צינור (רח)","אחזקת שבר","סלבה פיליפנקו","שטח משותף > מינוס 3 / חניון / מתקן משאבות בור שומן","","כל 2 חודשים","1/12/26","9/2/26","סמיון  קיפניס"`,
].join("\n");

test("parses Visitt's scheduled calls export", () => {
  const parsed = parseScheduledCallsImportContent(VISITT_EXPORT, "תזמונים קבועים.csv");
  assert.ok("rows" in parsed, JSON.stringify(parsed));
  assert.equal(parsed.rows.length, 3);
  const [first, , third] = parsed.rows;
  assert.equal(first!.externalId, "69f9a44d15622cd846d28a0f");
  assert.equal(first!.description, "ניקיון חדרים טכניים");
  assert.deepEqual(first!.assignees, ["סלבה פיליפנקו", "נדיה סובול"]);
  assert.equal(first!.location, "בניין A");
  assert.equal(first!.frequency, "כל 3 חודשים");
  // Day-first: 9/2/27 is 9 February 2027.
  assert.equal(first!.nextRun, "2027-02-09");
  assert.equal(first!.createdAt?.slice(0, 10), "2026-05-05");
  assert.equal(first!.createdBy, "אורה סרטורי");
  assert.equal(third!.location, "שטח משותף > מינוס 3 / חניון / מתקן משאבות בור שומן");
  assert.equal(third!.nextRun, "2026-12-01");
  assert.equal(third!.rowNumber, 4);
});

test("an unknown schedule names its row", () => {
  const csv = `"תיאור","תזמון"\n"x","לפעמים"`;
  const parsed = parseScheduledCallsImportContent(csv, "a.csv");
  assert.ok("error" in parsed);
  assert.equal(parsed.message, `${UNKNOWN_CALL_SCHEDULE_PREFIX}2:לפעמים`);
});

test("every 3 months opens on the next run's day, phased to its month", () => {
  const now = new Date("2026-11-20T10:00:00+02:00");
  const result = scheduledCallScheduleFromImport("כל 3 חודשים", "2027-02-09", "2026-05-05T00:00:00+03:00", now);
  assert.ok(result);
  assert.deepEqual(result.schedule, {
    frequency: "custom",
    weekdays: null,
    intervalCount: 3,
    intervalUnit: "month",
    startDayOfMonth: 9,
    startMonth: null,
  });
  // Feb 2027 is 9 months after May 2026: already in phase, keep created_at.
  assert.equal(result.anchorAt, null);
});

test("every 2 months re-phases created_at so the cron opens it on the next run", () => {
  const now = new Date("2026-11-20T10:00:00+02:00");
  const result = scheduledCallScheduleFromImport("כל 2 חודשים", "2026-12-01", "2026-02-09T00:00:00+03:00", now);
  assert.ok(result);
  assert.equal(result.schedule.frequency, "custom");
  assert.equal(result.schedule.intervalUnit, "month");
  assert.equal(result.schedule.intervalCount, 2);
  assert.equal(result.schedule.startDayOfMonth, 1);
  // Feb → Dec is 10 months: in phase as well.
  assert.equal(result.anchorAt, null);
});

test("every day, and the Hebrew/English forms without \"every\"", () => {
  assert.deepEqual(scheduledCallScheduleFromImport("כל יום", null, null)?.schedule.weekdays, [0, 1, 2, 3, 4]);
  assert.equal(scheduledCallScheduleFromImport("3 חודשים", null, null)?.schedule.intervalCount, 3);
  assert.equal(scheduledCallScheduleFromImport("every 2 months", null, null)?.schedule.intervalCount, 2);
});

test("every N weeks is stored as N*7 days, with no weekday", () => {
  const result = scheduledCallScheduleFromImport("כל 2 שבועות", "2026-12-01", "2026-11-03T00:00:00+02:00");
  assert.ok(result);
  assert.deepEqual(result.schedule, {
    frequency: "custom",
    weekdays: null,
    intervalCount: 14,
    intervalUnit: "day",
    startDayOfMonth: null,
    startMonth: null,
  });
  // 2026-11-03 + 14 * 2 = 2026-12-01: in phase.
  assert.equal(result.anchorAt, null);
  const shifted = scheduledCallScheduleFromImport("כל 2 שבועות", "2026-12-02", "2026-11-03T00:00:00+02:00");
  // The latest in-phase day on or before created_at (Dec 2 - 6 * 7 days).
  assert.equal(shifted?.anchorAt, "2026-10-21T12:00:00+03:00");
});

test("weekly becomes daily on the next run's weekday", () => {
  // 2026-12-01 is a Tuesday.
  const result = scheduledCallScheduleFromImport("כל שבוע", "2026-12-01", null);
  assert.ok(result);
  assert.equal(result.schedule.frequency, "day");
  assert.deepEqual(result.schedule.weekdays, [2]);
});
