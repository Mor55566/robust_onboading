// Deletes the demo tour history generated for a complex (runs marked external_id 'demo-history-…').
// The tour templates themselves are kept.
// Usage: node --env-file=.env.local scripts/delete_demo_history.mjs <complex-id> [--yes]
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);
const complexId = process.argv[2];
const confirmed = process.argv.includes("--yes");
if (!complexId) throw new Error("usage: delete_demo_history.mjs <complex-id> [--yes]");

const ctx = () => sql`SELECT set_config('app.user_role','super_admin',true), set_config('app.user_id','00000000-0000-0000-0000-000000000000',true), set_config('app.user_complex_ids','{}',true), set_config('app.user_admin_complex_ids','{}',true)`;
const demoRuns = sql`
  SELECT id FROM tasks
  WHERE type = 'mission' AND external_id LIKE 'demo-history-%'
    AND building_id IN (SELECT id FROM buildings WHERE complex_id = ${complexId})`;

const [, count] = await sql.transaction([ctx(), sql`SELECT count(*)::int n FROM (${demoRuns}) d`]);
console.log(`demo runs found: ${count[0].n}`);
if (!confirmed) {
  console.log("dry run — pass --yes to delete");
  process.exit(0);
}

await sql.transaction([
  ctx(),
  sql`DELETE FROM task_checklist_items WHERE task_checklist_id IN (SELECT id FROM task_checklists WHERE task_id IN (${demoRuns}))`,
  sql`DELETE FROM checklist_locations WHERE task_checklist_id IN (SELECT id FROM task_checklists WHERE task_id IN (${demoRuns}))`,
  sql`DELETE FROM task_checklists WHERE task_id IN (${demoRuns})`,
  sql`DELETE FROM tasks WHERE id IN (${demoRuns})`,
]);
console.log("deleted");
