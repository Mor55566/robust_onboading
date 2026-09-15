-- Root cause of the generic "Import failed" error on the super-admin
-- equipment upload: src/lib/building.ts special-cases role === "super_admin"
-- to grant access to every building at the APPLICATION layer (see
-- getAccessibleBuildings / userCanAccessBuilding / getAdminBuildingIds), so
-- the import logic in src/app/actions/admin-shared.ts (importEquipmentAction)
-- happily builds INSERT/UPDATE statements for any building. But the single
-- RLS policy on public.equipment, equipment_access (FOR ALL), only allows
-- access when the building's complex_id is in app.user_complex_ids — which
-- comes from user_complex_permissions rows a super_admin typically doesn't
-- have (they don't need explicit per-complex grants). So Postgres silently
-- rejects the write with "new row violates row-level security policy for
-- table equipment", which importEquipmentAction previously had no try/catch
-- around, surfacing only as the client's generic "Import failed" banner.
--
-- This mirrors the same gap already fixed for buildings/complexes/floors
-- (see db/buildings_add_insert_policy.sql,
-- db/complexes_add_select_super_admin_bypass.sql) — equipment never got the
-- same super_admin bypass clause.
--
-- Must be run with a role that owns public.equipment, not app_user.

DROP POLICY IF EXISTS equipment_access ON public.equipment;
CREATE POLICY equipment_access ON public.equipment
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.id = equipment.building_id
        AND b.complex_id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    )
    OR current_setting('app.user_role', true) = 'super_admin'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM buildings b
      WHERE b.id = equipment.building_id
        AND b.complex_id = ANY(NULLIF(current_setting('app.user_complex_ids', true), '{}')::uuid[])
    )
    OR current_setting('app.user_role', true) = 'super_admin'
  );
