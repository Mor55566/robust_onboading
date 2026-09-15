-- Root cause of "new row violates row-level security policy for table
-- complexes" even AFTER complexes_insert_admin was added: the failing
-- statement is `INSERT ... RETURNING id, name`, and under Postgres RLS,
-- RETURNING a just-inserted row also requires that row to be visible under
-- the table's SELECT policy — it's not only about the INSERT policy's WITH
-- CHECK. complexes_user_access (the only SELECT policy on this table) has
-- no super_admin bypass at all (unlike complexes_update_admin, which does
-- via `OR current_setting('app.user_role', true) = 'super_admin'`) — so a
-- super_admin can INSERT the row (that part already works) but Postgres then
-- refuses to RETURN it, since the SELECT policy alone decides it isn't
-- visible to them (a super_admin has no user_complex_permissions row for a
-- complex that didn't exist a moment ago). Confirmed by reproducing: the
-- same INSERT succeeds cleanly with RETURNING removed, and fails with
-- exactly this error once RETURNING is added back.
--
-- Fix: give complexes_user_access the same super_admin bypass
-- complexes_update_admin already has.
--
-- Must be run with a role that owns public.complexes, not app_user.

DROP POLICY IF EXISTS complexes_user_access ON public.complexes;
CREATE POLICY complexes_user_access ON public.complexes
  FOR SELECT
  USING (
    id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    OR current_setting('app.user_role', true) = 'super_admin'
  );
