-- tasks_call_number_uidx was UNIQUE on call_number alone, i.e. globally
-- across every complex. call_number is only the human-facing ticket number
-- (the real id is tasks.id, a uuid), and two complexes importing their own
-- Visitt tickets can legitimately reuse the same number. The ticket import
-- (importTasksAction in src/app/actions/super-admin.ts) failed with
-- 'duplicate key value violates unique constraint "tasks_call_number_uidx"'
-- whenever a number already existed in another complex.
--
-- tasks has no complex_id column (the complex comes from building_id ->
-- buildings.complex_id), so a unique index can't express "per complex".
-- Instead, assign_task_call_number() — which already serializes every
-- task insert with an advisory lock — rejects a number already used by
-- another task in the same complex. Automatic numbers still come from
-- task_call_number_seq, so they stay unique everywhere.
--
-- Must be run once with a role that owns public.tasks (e.g. neondb_owner),
-- not app_user — e.g. via the Neon SQL editor.

BEGIN;

DROP INDEX IF EXISTS public.tasks_call_number_uidx;

CREATE INDEX IF NOT EXISTS tasks_call_number_idx
ON public.tasks (call_number)
WHERE call_number IS NOT NULL;

CREATE OR REPLACE FUNCTION public.assign_task_call_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_last bigint;
  v_complex_id uuid;
BEGIN
  IF NEW.type <> 'task' THEN
    RETURN NEW;
  END IF;

  -- Serializes automatic and imported numbers.
  PERFORM pg_advisory_xact_lock(84622511);

  IF NEW.call_number IS NULL THEN
    NEW.call_number := nextval('public.task_call_number_seq');
  ELSIF NEW.call_number <= 0 THEN
    RAISE EXCEPTION 'call_number must be a positive integer';
  ELSE
    -- Imported numbers move the sequence forward so later calls don't collide.
    SELECT last_value INTO v_last FROM public.task_call_number_seq;
    IF NEW.call_number > v_last THEN
      PERFORM setval('public.task_call_number_seq', NEW.call_number, true);
    END IF;
  END IF;

  -- call_number is unique per complex, not globally.
  SELECT b.complex_id INTO v_complex_id
  FROM public.buildings b
  WHERE b.id = NEW.building_id;

  IF EXISTS (
    SELECT 1
    FROM public.tasks t
    INNER JOIN public.buildings b ON b.id = t.building_id
    WHERE t.call_number = NEW.call_number
      AND t.type = 'task'
      AND t.id <> NEW.id
      AND b.complex_id IS NOT DISTINCT FROM v_complex_id
  ) THEN
    RAISE EXCEPTION 'call_number % already exists in this complex', NEW.call_number
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$function$;

-- Also re-check when a task moves to another building (and so maybe
-- another complex). Renamed so it sorts after tasks_fill_building_id
-- (BEFORE triggers fire in name order) and sees building_id already filled
-- in from floor/area/equipment.
DROP TRIGGER IF EXISTS tasks_assign_call_number ON public.tasks;
DROP TRIGGER IF EXISTS tasks_set_call_number ON public.tasks;
CREATE TRIGGER tasks_set_call_number
BEFORE INSERT OR UPDATE OF call_number, type, building_id ON public.tasks
FOR EACH ROW EXECUTE FUNCTION assign_task_call_number();

COMMIT;
