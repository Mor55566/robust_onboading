-- Root cause of "permission denied for table tasks" when deleting tickets
-- from the super-admin "מחיקת קריאות" modal (deleteTicketsAction in
-- src/app/actions/super-admin.ts): app_user was granted SELECT, INSERT and
-- UPDATE on public.tasks but never DELETE. This is a table privilege, not
-- RLS — the tasks_access policy (FOR ALL) already lets super_admin through
-- (see db/tasks_add_super_admin_bypass.sql).
--
-- Rows in tables that reference tasks with ON DELETE CASCADE / SET NULL are
-- handled by the FK triggers, which run as the table owner, so no extra
-- grants are needed for them.
--
-- Must be run with a role that owns public.tasks (neondb_owner), not app_user.

GRANT DELETE ON public.tasks TO app_user;
