-- Retain a complete copy of each signature when OSC explicitly reopens a sheet.
create table public.gs_reopened_score_sheets (
 id bigint generated always as identity primary key,
 grader_id uuid not null,
 group_id uuid not null,
 reopened_at timestamptz not null default now(),
 verification jsonb not null,
 receipt jsonb
);
alter table public.gs_reopened_score_sheets enable row level security;
revoke all on public.gs_reopened_score_sheets from public, anon, authenticated;

create function public.gs_reopen_verified_sheet() returns trigger
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
 if auth.role() is distinct from 'service_role' then
   raise exception 'Chỉ quản trị OSC có thể mở lại bảng điểm.';
 end if;
 if exists(select 1 from public.competition_groups g join public.gs_castings c on c.id=g.casting_id
   where g.id=old.group_id and c.status in ('approved','published','archived'))
 or exists(select 1 from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id
   where c.group_id=old.group_id and (d.review_status <> 'pending' or d.synced_at is not null)) then
   raise exception 'Phiên đã duyệt hoặc công bố kết quả.';
 end if;
 with prior as (
   delete from public.gs_grading_receipts where grader_id=old.grader_id and group_id=old.group_id returning *
 )
 insert into public.gs_reopened_score_sheets(grader_id,group_id,verification,receipt)
 select old.grader_id,old.group_id,to_jsonb(old),(select to_jsonb(prior) from prior);
 update public.scores set locked=false, submitted_at=null, updated_at=now()
 where group_id=old.group_id and grader_id=old.grader_id and (locked or submitted_at is not null);
 return old;
end
$$;
revoke all on function public.gs_reopen_verified_sheet() from public,anon,authenticated;
create trigger gs_reopen_verified_sheet after delete on public.grader_verifications
 for each row when (pg_trigger_depth() = 0) execute function public.gs_reopen_verified_sheet();

-- Recover the signed status of older sheets whose UI lock was removed alone.
insert into public.grader_verifications(group_id,grader_id,grader_code,grader_name,is_verified,signed_at,updated_at)
select r.group_id,r.grader_id,p.code,r.grader_name,true,r.verified_at,now()
from public.gs_grading_receipts r join public.profiles p on p.id=r.grader_id
on conflict(group_id,grader_id) do update set is_verified=true,signed_at=excluded.signed_at,updated_at=now()
where grader_verifications.is_verified is distinct from true;
