-- floors had a UNIQUE constraint on (building_id, number), enforced by the
-- app at import time (src/app/actions/super-admin.ts, importFloorsAction).
-- Level 0 is now used as an unbounded bucket (e.g. storage rooms, parking —
-- entries that don't need a distinct level), so any number of floors can
-- share number 0 within a building. Every other level must stay unique per
-- building; the app still enforces that.
--
-- This replaces the table-wide unique constraint with a partial unique index
-- that excludes number = 0, so Postgres only enforces uniqueness for every
-- other level.
--
-- Must be run with a role that owns public.floors (e.g. via
-- DATABASE_OWNER_URL), not the RLS-restricted app_user the app connects as.

ALTER TABLE public.floors DROP CONSTRAINT IF EXISTS floors_building_number_key;

CREATE UNIQUE INDEX IF NOT EXISTS floors_building_number_key
  ON public.floors (building_id, number)
  WHERE number <> 0;
