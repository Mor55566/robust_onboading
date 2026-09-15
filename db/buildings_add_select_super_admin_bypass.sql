-- Same root cause as db/complexes_add_select_super_admin_bypass.sql: after
-- buildings_insert_admin was added, INSERT ... RETURNING still fails with
-- "new row violates row-level security policy for table buildings" — the
-- INSERT's WITH CHECK passes, but under FORCE ROW LEVEL SECURITY, RETURNING
-- the just-inserted row also requires it to be visible under the table's
-- SELECT policy. buildings_user_access (the only SELECT policy on this
-- table) has no super_admin bypass, so a super_admin can INSERT a building
-- but Postgres refuses to RETURN it — they have no user_complex_permissions
-- row for a complex_id that didn't exist a moment ago.
--
-- Confirmed via direct inspection of pg_policy: buildings_user_access's
-- qual is exactly:
--   complex_id = ANY (NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
-- with no super_admin clause, unlike buildings_update_admin/
-- buildings_delete_admin, which both already have one.
--
-- Fix: give buildings_user_access the same super_admin bypass those two
-- already have.
--
-- Must be run with a role that owns public.buildings, not app_user.

DROP POLICY IF EXISTS buildings_user_access ON public.buildings;
CREATE POLICY buildings_user_access ON public.buildings
  FOR SELECT
  USING (
    complex_id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    OR current_setting('app.user_role', true) = 'super_admin'
  );
