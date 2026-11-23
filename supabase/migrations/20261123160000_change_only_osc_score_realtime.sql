-- OSC embedded score console: change-only invalidation over Supabase Realtime.
-- Public observers see ONLY a table name and monotonically increasing version.
-- No candidate, grader, score, or OSC Firebase identity is exposed.
CREATE SCHEMA IF NOT EXISTS gradesync_internal;
REVOKE ALL ON SCHEMA gradesync_internal FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.gs_change_signal (
  scope text PRIMARY KEY CHECK (scope IN (
    'profiles','competition_groups','candidates','scores',
    'grader_verifications','attendance_realtime',
    'group_publication_index','audit_logs','submission_notifications'
  )),
  version bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.gs_change_signal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gs_change_signal FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.gs_change_signal TO anon, authenticated;
DROP POLICY IF EXISTS gs_change_signal_read_only ON public.gs_change_signal;
CREATE POLICY gs_change_signal_read_only
 ON public.gs_change_signal FOR SELECT TO anon, authenticated
 USING (true);

INSERT INTO public.gs_change_signal(scope,version)
SELECT scope,0 FROM (VALUES
 ('profiles'),('competition_groups'),('candidates'),('scores'),
 ('grader_verifications'),('attendance_realtime'),
 ('group_publication_index'),('audit_logs'),('submission_notifications')
) AS scopes(scope)
ON CONFLICT(scope) DO NOTHING;

CREATE OR REPLACE FUNCTION gradesync_internal.emit_change_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $$
BEGIN
 UPDATE public.gs_change_signal
 SET version=version+1
 WHERE scope=TG_TABLE_NAME;
 RETURN COALESCE(NEW,OLD);
END
$$;
REVOKE ALL ON FUNCTION gradesync_internal.emit_change_signal() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY[
  'profiles','competition_groups','candidates','scores',
  'grader_verifications','attendance_realtime',
  'group_publication_index','audit_logs','submission_notifications'
 ] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS gs_change_signal_emit ON public.%I',tbl);
  EXECUTE format('CREATE TRIGGER gs_change_signal_emit AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION gradesync_internal.emit_change_signal()',tbl);
 END LOOP;
 IF NOT EXISTS (
  SELECT 1 FROM pg_publication_tables
  WHERE pubname='supabase_realtime'
    AND schemaname='public'
    AND tablename='gs_change_signal'
 ) THEN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.gs_change_signal;
 END IF;
END $$;
