// Syncs ONLY the "next run" of existing scheduled missions in one complex from
// an exporter CSV (copy_scheduled_missions / mission-export-script). Nothing
// else is touched: no titles, checklists, locations, assignees or frequency.
//
// missions_cron has no next-run column; it derives the next opening from
// mission_schedules.weekday / start_day_of_month / start_month and, for
// "every N" cadences, from tasks.created_at. Those are the only fields written
// (see applyNextRunToSchedule in src/lib/mission-import.ts).
//
// Safety:
// - Dry run by default; pass --apply to write.
// - Missions are matched by title within the complex. A title that is
//   ambiguous (several DB templates or several file missions with different
//   next runs), or whose frequency differs between the file and the DB, is
//   skipped and reported.
// - Before writing, the current values are saved to a JSON backup.
// - Each UPDATE only applies if the row still has the values read in this run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/sync_mission_next_run.mts <complex-id> <file.csv> [--apply] [--backup-dir <dir>]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import {
  applyNextRunToSchedule,
  parseMissionFrequency,
  parseMissionsImportContent,
  type ParsedMissionSchedule,
} from "../src/lib/mission-import";
import { normalizeLookup } from "../src/lib/task-import";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const backupDirIndex = args.indexOf("--backup-dir");
const backupDir = backupDirIndex >= 0 ? args[backupDirIndex + 1]! : "scripts/backups";
const positional = args.filter(
  (arg, index) =>
    !arg.startsWith("--") && !(backupDirIndex >= 0 && index === backupDirIndex + 1),
);
const [complexId, filePath] = positional;
if (!complexId || !filePath) {
  throw new Error(
    "usage: sync_mission_next_run.mts <complex-id> <file.csv> [--apply] [--backup-dir <dir>]",
  );
}

const sql = neon(process.env.DATABASE_URL!);
const ctx = () =>
  sql`SELECT set_config('app.user_role','super_admin',true), set_config('app.user_id','00000000-0000-0000-0000-000000000000',true), set_config('app.user_complex_ids','{}',true), set_config('app.user_admin_complex_ids','{}',true)`;

const parsed = parseMissionsImportContent(
  readFileSync(filePath, "utf8"),
  path.basename(filePath),
);
if ("error" in parsed) {
  console.error("The file was rejected:", parsed.error, parsed.message ?? "");
  process.exit(1);
}

type DbTemplate = {
  id: string;
  title: string;
  created_at: string;
  /** Exact DB text (keeps microseconds a JS Date would drop). */
  created_at_raw: string;
  is_hidden: boolean;
  frequency: string;
  weekdays: number[] | null;
  weekday: number | null;
  interval_count: number | null;
  interval_unit: string | null;
  start_day_of_month: number | null;
  start_month: number | null;
  end_weekday: number | null;
  end_day_of_month: number | null;
  never_closes: boolean;
  paused_at: string | null;
};

const [, templates] = (await sql.transaction([
  ctx(),
  sql`
    SELECT t.id, t.title, t.created_at, t.created_at::text AS created_at_raw, t.is_hidden,
           ms.frequency, ms.weekdays, ms.weekday, ms.interval_count, ms.interval_unit,
           ms.start_day_of_month, ms.start_month, ms.end_weekday, ms.end_day_of_month,
           ms.never_closes, ms.paused_at
    FROM tasks t
    JOIN mission_schedules ms ON ms.template_mission_id = t.id
    WHERE t.type = 'template-mission'
      AND t.building_id IN (SELECT id FROM buildings WHERE complex_id = ${complexId})
    ORDER BY t.created_at ASC
  `,
])) as [unknown, DbTemplate[]];

const dbByTitle = new Map<string, DbTemplate[]>();
for (const template of templates) {
  if (template.is_hidden) continue;
  const key = normalizeLookup(template.title ?? "");
  dbByTitle.set(key, [...(dbByTitle.get(key) ?? []), template]);
}
const fileByTitle = new Map<string, typeof parsed.rows>();
for (const row of parsed.rows) {
  const key = normalizeLookup(row.title);
  fileByTitle.set(key, [...(fileByTitle.get(key) ?? []), row]);
}

const DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const fmt = (field: string, value: unknown) =>
  value == null ? "∅" : field === "weekday" ? DAYS[value as number] : String(value);

type Change = {
  template: DbTemplate;
  nextRun: string;
  updates: { weekday?: number; start_day_of_month?: number; start_month?: number; created_at?: string };
};
const changes: Change[] = [];
const unchanged: string[] = [];
const skipped: string[] = [];
const notFound: string[] = [];

for (const [key, fileRows] of fileByTitle) {
  const title = fileRows[0]!.title;
  const dbRows = dbByTitle.get(key) ?? [];
  if (dbRows.length === 0) {
    notFound.push(title);
    continue;
  }
  const nextRuns = new Set(fileRows.map((row) => row.nextRun ?? ""));
  const frequencies = new Set(fileRows.map((row) => row.frequency));
  if (nextRuns.size > 1 || frequencies.size > 1) {
    skipped.push(`${title}: appears ${fileRows.length}× in the file with different next runs/frequencies`);
    continue;
  }
  const nextRun = fileRows[0]!.nextRun;
  if (!nextRun) {
    skipped.push(`${title}: no next run in the file (paused in Visitt)`);
    continue;
  }
  const fileSchedule = parseMissionFrequency(fileRows[0]!.frequency);

  for (const db of dbRows) {
    const label = dbRows.length > 1 ? `${title} [${db.id}]` : title;
    if (
      db.frequency !== fileSchedule.frequency ||
      (db.frequency === "custom" &&
        (db.interval_count !== fileSchedule.intervalCount ||
          db.interval_unit !== fileSchedule.intervalUnit))
    ) {
      skipped.push(
        `${label}: frequency differs (file "${fileRows[0]!.frequency}", DB ${db.frequency}${db.frequency === "custom" ? ` ${db.interval_count} ${db.interval_unit}` : ""})`,
      );
      continue;
    }

    // Base on the DB's own schedule so nothing but the next-run fields moves.
    const base: ParsedMissionSchedule = {
      frequency: db.frequency as ParsedMissionSchedule["frequency"],
      weekdays: db.weekdays,
      weekday: db.weekday,
      intervalCount: db.interval_count,
      intervalUnit: db.interval_unit as ParsedMissionSchedule["intervalUnit"],
      startDayOfMonth: db.start_day_of_month,
      startMonth: db.start_month,
    };
    const { schedule, anchorAt } = applyNextRunToSchedule(
      base,
      nextRun,
      new Date(db.created_at).toISOString(),
    );

    const updates: Change["updates"] = {};
    if (schedule.weekday !== db.weekday && schedule.weekday != null) updates.weekday = schedule.weekday;
    if ((schedule.startDayOfMonth ?? null) !== db.start_day_of_month && schedule.startDayOfMonth != null)
      updates.start_day_of_month = schedule.startDayOfMonth;
    if ((schedule.startMonth ?? null) !== db.start_month && schedule.startMonth != null)
      updates.start_month = schedule.startMonth;
    if (anchorAt) updates.created_at = anchorAt;

    if (Object.keys(updates).length === 0) unchanged.push(label);
    else changes.push({ template: { ...db, title: label }, nextRun, updates });
  }
}

const dbMissing = [...dbByTitle.entries()]
  .filter(([key]) => !fileByTitle.has(key))
  .flatMap(([, rows]) => rows.map((row) => row.title));

console.log(`\nFile: ${parsed.rows.length} missions · DB: ${templates.filter((t) => !t.is_hidden).length} templates in complex\n`);
console.log(`=== Will change (${changes.length}) ===`);
for (const change of changes) {
  const parts = Object.entries(change.updates).map(([field, value]) => {
    const before = (change.template as Record<string, unknown>)[field];
    const beforeText = field === "created_at" ? new Date(before as string).toISOString().slice(0, 10) : fmt(field, before);
    const afterText = field === "created_at" ? (value as string).slice(0, 10) : fmt(field, value);
    return `${field}: ${beforeText} → ${afterText}`;
  });
  console.log(`- ${change.template.title} | ${change.template.frequency}${change.template.frequency === "custom" ? ` ${change.template.interval_count} ${change.template.interval_unit}` : ""} | next run ${change.nextRun} | ${parts.join(", ")}`);
}
console.log(`\n=== Already correct (${unchanged.length}) ===`);
for (const line of unchanged) console.log(`- ${line}`);
console.log(`\n=== Skipped (${skipped.length}) ===`);
for (const line of skipped) console.log(`- ${line}`);
console.log(`\n=== In file but not in DB (${notFound.length}) ===`);
for (const line of notFound) console.log(`- ${line}`);
console.log(`\n=== In DB but not in file (${dbMissing.length}) — untouched ===`);
for (const line of dbMissing) console.log(`- ${line}`);

// Close windows: a moved start day with no explicit end keeps the old end
// (weekly → Saturday, monthly → end of month), so the open window shrinks.
const windowNotes = changes.filter(
  ({ template, updates }) =>
    !template.never_closes &&
    ((updates.weekday != null && template.end_weekday == null) ||
      (updates.start_day_of_month != null &&
        updates.start_day_of_month !== 1 &&
        template.end_day_of_month == null)),
);
console.log(`\n=== Close window note (${windowNotes.length}) ===`);
console.log("Missions that auto-close and have no explicit end day — their open window will run from the new start day to Saturday / end of month:");
for (const { template } of windowNotes) console.log(`- ${template.title}`);

if (!apply) {
  console.log("\nDry run — nothing written. Pass --apply to write.");
  process.exit(0);
}
if (changes.length === 0) {
  console.log("\nNothing to write.");
  process.exit(0);
}

mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(
  backupDir,
  `next-run-backup-${complexId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
);
writeFileSync(
  backupFile,
  JSON.stringify(
    changes.map(({ template }) => ({
      id: template.id,
      title: template.title,
      weekday: template.weekday,
      start_day_of_month: template.start_day_of_month,
      start_month: template.start_month,
      created_at: template.created_at_raw,
    })),
    null,
    2,
  ),
);
console.log(`\nBackup written: ${backupFile}`);

const queries = [ctx()];
for (const { template, updates } of changes) {
  if (updates.weekday != null || updates.start_day_of_month != null || updates.start_month != null) {
    queries.push(sql`
      UPDATE mission_schedules
      SET weekday = ${updates.weekday ?? template.weekday},
          start_day_of_month = ${updates.start_day_of_month ?? template.start_day_of_month},
          start_month = ${updates.start_month ?? template.start_month},
          updated_at = now()
      WHERE template_mission_id = ${template.id}
        AND weekday IS NOT DISTINCT FROM ${template.weekday}::smallint
        AND start_day_of_month IS NOT DISTINCT FROM ${template.start_day_of_month}::smallint
        AND start_month IS NOT DISTINCT FROM ${template.start_month}::smallint
      RETURNING template_mission_id
    `);
  }
  if (updates.created_at) {
    queries.push(sql`
      UPDATE tasks
      SET created_at = ${updates.created_at}::timestamptz
      WHERE id = ${template.id}
        AND type = 'template-mission'
        AND created_at = ${template.created_at_raw}::timestamptz
      RETURNING id
    `);
  }
}
const results = (await sql.transaction(queries)) as unknown[][];
const written = results.slice(1).filter((rows) => rows.length > 0).length;
console.log(`Updated ${written}/${queries.length - 1} rows (a row is skipped if it changed since the dry run).`);
