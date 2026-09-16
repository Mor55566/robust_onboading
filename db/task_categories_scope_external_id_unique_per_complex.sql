-- Root cause of "לא ניתן לייבא קטגוריות: must be owner of table
-- task_categories" on the categories import (importCategoriesAction in
-- src/app/actions/super-admin.ts): that action used to run this migration
-- inline, on every import, using the app's own app_user role. app_user only
-- has INSERT/UPDATE/SELECT on task_categories, not ALTER TABLE / CREATE
-- INDEX / DROP INDEX, so the very first statement always failed.
--
-- Must be run once with a role that owns public.task_categories (e.g.
-- neondb_owner), not app_user — e.g. via the Neon SQL editor.
--
-- This also fixes a real bug, not just the permissions error:
-- task_categories_external_id_uidx was UNIQUE on external_id alone, i.e.
-- globally across every complex. But external_id is only meaningful as a
-- stable id within one Visitt export — two different complexes importing
-- their own Visitt category list can legitimately reuse the same
-- external_id (e.g. the console-script export in scripts/copy_task_categories.js
-- always numbers categories 1, 2, 3… from scratch). Scope the uniqueness to
-- (complex_id, external_id) instead.

ALTER TABLE public.task_categories DROP CONSTRAINT IF EXISTS task_categories_name_key;

DROP INDEX IF EXISTS task_categories_external_id_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS task_categories_complex_external_id_uidx
ON public.task_categories (complex_id, external_id)
WHERE external_id IS NOT NULL;
