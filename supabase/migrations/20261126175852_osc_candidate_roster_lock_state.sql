create or replace function public.osc_candidate_roster_locked(p_group uuid) returns boolean language sql stable security invoker set search_path='' as $$
select not exists(select 1 from public.competition_groups g join public.gs_castings c on c.id=g.casting_id where g.id=p_group and g.osc_deleted_at is null and c.status not in ('published','archived'))
or exists(select 1 from public.osc_group_publications where group_id=p_group and cancelled_at is null)
or exists(select 1 from public.grader_verifications where group_id=p_group and is_verified)
or exists(select 1 from public.gs_grading_receipts where group_id=p_group)
or exists(select 1 from gradesync_internal.attendance_locks where group_id=p_group);
$$;
revoke all on function public.osc_candidate_roster_locked(uuid) from public,anon,authenticated;
grant execute on function public.osc_candidate_roster_locked(uuid) to service_role;
notify pgrst,'reload schema';