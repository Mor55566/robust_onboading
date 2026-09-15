-- public.complexes has RLS FORCED with a SELECT policy (complexes_user_access)
-- and an UPDATE policy (complexes_update_admin, added later — see
-- with_robust_app's db/complexes_add_update_policy.sql), but NO INSERT
-- policy at all. Nothing in with_robust_app ever inserted into complexes
-- before (only updateComplexAction existed there); this app's
-- createComplexAction (src/app/actions/complexes.ts) is the first to do so,
-- and was blocked with "new row violates row-level security policy for
-- table complexes" until this policy exists. Mirrors
-- complexes_update_admin's super_admin bypass exactly.
--
-- Must be run with a role that owns public.complexes (e.g. via
-- DATABASE_OWNER_URL), not the RLS-restricted app_user the app itself
-- connects as.

DROP POLICY IF EXISTS complexes_insert_admin ON public.complexes;
CREATE POLICY complexes_insert_admin ON public.complexes
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) = 'super_admin'
  );
