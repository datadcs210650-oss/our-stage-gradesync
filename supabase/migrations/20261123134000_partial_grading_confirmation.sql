-- Explicit partial-score confirmations: no forced scores, no fabricated zeroes.
-- Maintain immutable receipt snapshot and record an auditable completeness summary.
alter table public.gs_grading_receipts
 add column if not exists completeness jsonb not null default '{}'::jsonb;

create or replace function public.gs_finalize_grading_otp(
 p_grader uuid,p_group uuid,p_digest text
) returns jsonb
language plpgsql security definer set search_path = pg_catalog,public
as $$
declare
 ch public.gs_otp_challenges%rowtype;
 v_profile public.profiles%rowtype;
 v_snapshot jsonb;v_hash text;
 v_total integer;v_count integer;v_missing integer;
 v_completeness jsonb;
begin
 select * into ch from public.gs_otp_challenges
  where grader_id=p_grader and group_id=p_group for update;
 if not found or ch.used_at is not null then
  return jsonb_build_object('ok',false,'code','OTP_UNAVAILABLE');end if;
 if ch.expires_at<now() then return jsonb_build_object('ok',false,'code','OTP_EXPIRED');end if;
 if ch.failed_attempts>=5 then return jsonb_build_object('ok',false,'code','OTP_LOCKED');end if;
 if ch.otp_digest<>p_digest then
  update public.gs_otp_challenges set failed_attempts=failed_attempts+1
   where grader_id=p_grader and group_id=p_group;
  return jsonb_build_object('ok',false,'code','OTP_INVALID');
 end if;
 select * into v_profile from public.profiles
  where id=p_grader and role='Grader' and status='Active';
 if not found then return jsonb_build_object('ok',false,'code','GRADER_INACTIVE');end if;
 if not exists(select 1 from public.grader_assignments
   where grader_id=p_grader and group_id=p_group) then
  return jsonb_build_object('ok',false,'code','NOT_ASSIGNED');end if;
 if exists(select 1 from public.gs_grading_receipts
   where grader_id=p_grader and group_id=p_group) then
  return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED');end if;

 select count(*) into v_total from public.candidates where group_id=p_group;
 select count(*) into v_count from public.scores s
   where s.group_id=p_group and s.grader_id=p_grader
   and jsonb_typeof(s.scores)='object' and s.scores <> '{}'::jsonb;
 select count(*) into v_missing
 from public.candidates c join public.competition_groups g on g.id=c.group_id
 cross join lateral jsonb_array_elements(g.criteria) cr
 left join public.scores s on s.candidate_id=c.id and s.group_id=p_group
     and s.grader_id=p_grader
 where c.group_id=p_group
 and (not exists(select 1 from public.gs_criterion_grants ag
       where ag.grader_id=p_grader and ag.group_id=p_group)
   or exists(select 1 from public.gs_criterion_grants ag
       where ag.grader_id=p_grader and ag.group_id=p_group
         and ag.criterion=cr->>'name'))
 and (s.id is null or not coalesce(s.scores,'{}'::jsonb) ? (cr->>'name'));

 v_completeness:=jsonb_build_object(
   'totalCandidates',v_total,'scoredCandidates',v_count,
   'missingCandidates',greatest(v_total-v_count,0),
   'missingCriterionCells',v_missing,
   'partial',v_count<v_total or v_missing>0
 );
 select coalesce(jsonb_agg(jsonb_build_object(
  'candidateId',s.candidate_id,'scores',s.scores,
  'total',s.total_score,'revision',s.revision) order by s.candidate_id),'[]'::jsonb)
 into v_snapshot from public.scores s
 where s.group_id=p_group and s.grader_id=p_grader;
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 update public.scores set locked=true,submitted_at=now(),updated_at=now()
 where group_id=p_group and grader_id=p_grader and locked=false;
 insert into public.gs_grading_receipts(
   grader_id,group_id,email,grader_name,verified_at,snapshot,snapshot_sha256,completeness
 ) select p_grader,p_group,a.email,v_profile.name,now(),
   v_snapshot,v_hash,v_completeness
 from public.gs_google_grader_access a
 where a.profile_id=p_grader and a.enabled=true;
 if not found then return jsonb_build_object('ok',false,'code','GOOGLE_NOT_INVITED');end if;
 insert into public.grader_verifications(
  group_id,grader_id,grader_code,grader_name,is_verified,signed_at,updated_at
 ) values(p_group,p_grader,v_profile.code,v_profile.name,true,now(),now())
 on conflict(group_id,grader_id) do update
  set is_verified=true,signed_at=now(),updated_at=now();
 update public.gs_otp_challenges set used_at=now()
 where grader_id=p_grader and group_id=p_group;
 return jsonb_build_object('ok',true,'sha256',v_hash,'confirmedAt',now(),
  'completeness',v_completeness);
end
$$;

revoke all on function public.gs_finalize_grading_otp(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gs_finalize_grading_otp(uuid,uuid,text) to service_role;
