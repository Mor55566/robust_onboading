-- Root cause of "new row violates row-level security policy for table
-- tasks" during the super-admin "קריאות" (tasks) upload: src/lib/building.ts
-- special-cases role === "super_admin" to grant access to every building at
-- the APPLICATION layer, so importTasksAction (src/app/actions/super-admin.ts)
-- happily builds INSERT/UPDATE statements for any building. But the single
-- RLS policy on public.tasks, tasks_access (FOR ALL), only allows access
-- when the building's complex_id is in app.user_complex_ids — which comes
-- from user_complex_permissions rows a super_admin typically doesn't have
-- (they don't need explicit per-complex grants). So Postgres silently
-- rejects the write.
--
-- This mirrors the same gap already fixed for buildings/complexes/equipment
-- (see db/buildings_add_insert_policy.sql,
-- db/complexes_add_select_super_admin_bypass.sql,
-- db/equipment_add_super_admin_bypass.sql) — tasks never got the same
-- super_admin bypass clause.
--
-- Must be run with a role that owns public.tasks, not app_user.

DROP POLICY IF EXISTS tasks_access ON public.tasks;
CREATE POLICY tasks_access ON public.tasks
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.id = tasks.building_id
        AND b.complex_id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    )
    OR current_setting('app.user_role', true) = 'super_admin'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.id = tasks.building_id
        AND b.complex_id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    )
    OR current_setting('app.user_role', true) = 'super_admin'
  );
