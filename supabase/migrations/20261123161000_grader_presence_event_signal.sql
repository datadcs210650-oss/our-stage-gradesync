-- Preserve BGK online/offline badges in the OSC console.
-- Unlike scores, this scope is signaled only when a grader session row
-- actually changes; there is no timer-driven HTTP polling in OSC.
ALTER TABLE public.gs_change_signal
 DROP CONSTRAINT IF EXISTS gs_change_signal_scope_check;
ALTER TABLE public.gs_change_signal
 ADD CONSTRAINT gs_change_signal_scope_check
 CHECK (scope IN (
  'profiles','competition_groups','candidates','scores',
  'grader_verifications','attendance_realtime','group_publication_index',
  'audit_logs','submission_notifications','grader_sessions'
 ));
INSERT INTO public.gs_change_signal(scope,version)
 VALUES ('grader_sessions',0)
 ON CONFLICT(scope) DO NOTHING;
DROP TRIGGER IF EXISTS gs_change_signal_emit ON public.grader_sessions;
CREATE TRIGGER gs_change_signal_emit
 AFTER INSERT OR UPDATE OR DELETE ON public.grader_sessions
 FOR EACH ROW EXECUTE FUNCTION gradesync_internal.emit_change_signal();
