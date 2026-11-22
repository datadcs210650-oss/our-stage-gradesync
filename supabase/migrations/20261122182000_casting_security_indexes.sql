-- Tighten helper privileges and indexes after casting security audit.
-- Trigger functions are never intended as exposed RPCs.
revoke all on function public.gs_guard_score_write() from public, anon, authenticated;
revoke all on function public.gs_guard_otp_verification() from public, anon, authenticated;
create or replace function public.gs_has_receipt(p_grader uuid,p_group uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth
as $$
 select p_grader=coalesce(public.gs_current_grader_id(),(select auth.uid()))
  and exists(select 1 from public.gs_grading_receipts where grader_id=p_grader and group_id=p_group)
$$;
revoke all on function public.gs_has_receipt(uuid,uuid) from public,anon;
grant execute on function public.gs_has_receipt(uuid,uuid) to authenticated;
create index if not exists gs_receipts_by_group_idx on public.gs_grading_receipts(group_id);
create index if not exists gs_otp_by_group_idx on public.gs_otp_challenges(group_id);
create index if not exists gs_decisions_by_candidate_idx on public.gs_casting_decisions(candidate_id);
create index if not exists gs_sync_by_candidate_idx on public.gs_membership_sync_queue(candidate_id);
create index if not exists gs_notification_casting_idx on public.gs_casting_notifications(casting_id,created_at);
create index if not exists gs_grader_assignments_by_group_idx on public.grader_assignments(group_id);
create index if not exists gs_candidate_group_idx on public.candidates(group_id);
