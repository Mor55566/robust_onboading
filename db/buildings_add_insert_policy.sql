-- public.buildings has RLS FORCED with a SELECT policy, but no INSERT
-- policy — nothing in this app has ever inserted into buildings before (they
-- were only ever matched by name during floor/area/equipment imports). The
-- new "add building" button (src/app/actions/buildings.ts,
-- createBuildingAction) is the first thing to INSERT into buildings, and
-- will fail with "new row violates row-level security policy for table
-- buildings" until this policy exists. Mirrors
-- db/complexes_add_insert_policy.sql exactly.
--
-- Must be run with a role that owns public.buildings (e.g. via
-- DATABASE_OWNER_URL), not the RLS-restricted app_user the app itself
-- connects as.
--
-- If INSERT ... RETURNING also fails afterwards, the SELECT policy likely
-- needs a super_admin bypass too — see
-- db/complexes_add_select_super_admin_bypass.sql for the equivalent fix on
-- complexes; inspect the buildings SELECT policy definition and add the same
-- `OR current_setting('app.user_role', true) = 'super_admin'` clause if it's
-- missing.

DROP POLICY IF EXISTS buildings_insert_admin ON public.buildings;
CREATE POLICY buildings_insert_admin ON public.buildings
  FOR INSERT
  WITH CHECK (
    current_setting('app.user_role', true) = 'super_admin'
  );
