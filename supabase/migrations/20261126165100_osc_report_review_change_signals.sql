-- Version-only signals: no candidate, judge or result data is published.
alter table public.gs_change_signal drop constraint gs_change_signal_scope_check;
alter table public.gs_change_signal add constraint gs_change_signal_scope_check check(scope in ('profiles','competition_groups','candidates','scores','grader_verifications','attendance_realtime','group_publication_index','audit_logs','submission_notifications','grader_sessions','gs_casting_decisions','gs_castings'));
insert into public.gs_change_signal(scope) values('gs_casting_decisions'),('gs_castings') on conflict(scope) do nothing;
create trigger gs_change_signal_emit after insert or update or delete on public.gs_casting_decisions for each statement execute function gradesync_internal.emit_change_signal();
create trigger gs_change_signal_emit after insert or update or delete on public.gs_castings for each statement execute function gradesync_internal.emit_change_signal();