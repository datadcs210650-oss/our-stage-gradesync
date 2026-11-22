-- Server-side OTP lock and immutable grading receipt.
-- These RPCs are service_role-only; the frontend never receives an OTP digest.
create or replace function public.gs_issue_grading_otp(
 p_grader uuid,p_group uuid,p_digest text,p_expires timestamptz
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare old public.gs_otp_challenges%rowtype;
begin
 if p_digest !~ '^[0-9a-f]{64}$' or p_expires<=now()
    or p_expires>now()+interval '10 minutes' then
  return jsonb_build_object('ok',false,'code','INVALID_OTP_REQUEST');
 end if;
 select * into old from public.gs_otp_challenges where grader_id=p_grader and group_id=p_group for update;
 if found and old.sent_at>now()-interval '60 seconds' then
  return jsonb_build_object('ok',false,'code','COOLDOWN');
 end if;
 if exists(select 1 from public.gs_grading_receipts where grader_id=p_grader and group_id=p_group)
 then return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED');end if;
 insert into public.gs_otp_challenges(grader_id,group_id,otp_digest,expires_at,sent_at,failed_attempts,used_at)
 values(p_grader,p_group,p_digest,p_expires,now(),0,null)
 on conflict(grader_id,group_id) do update set otp_digest=excluded.otp_digest,
 expires_at=excluded.expires_at,sent_at=excluded.sent_at,failed_attempts=0,used_at=null;
 return jsonb_build_object('ok',true);
end
$$;
create or replace function public.gs_finalize_grading_otp(
 p_grader uuid,p_group uuid,p_digest text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public
as $$
declare ch public.gs_otp_challenges%rowtype;
 v_profile public.profiles%rowtype;v_snapshot jsonb;v_hash text;
 v_total integer;v_count integer;v_expected integer;v_missing integer;
begin
 select * into ch from public.gs_otp_challenges
 where grader_id=p_grader and group_id=p_group for update;
 if not found or ch.used_at is not null then return jsonb_build_object('ok',false,'code','OTP_UNAVAILABLE');end if;
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
 if not exists(select 1 from public.grader_assignments where grader_id=p_grader and group_id=p_group)
 then return jsonb_build_object('ok',false,'code','NOT_ASSIGNED');end if;
 if exists(select 1 from public.gs_grading_receipts where grader_id=p_grader and group_id=p_group)
 then return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED');end if;
 select count(*) into v_total from public.candidates where group_id=p_group;
 select count(*) into v_count from public.scores where group_id=p_group and grader_id=p_grader
   and jsonb_typeof(scores)='object' and jsonb_object_length(scores)>0;
 if v_count=0 or v_count<v_total then
  return jsonb_build_object('ok',false,'code','INCOMPLETE_SCORE_COUNT','scored',v_count,'expected',v_total);
 end if;
 -- Every assigned criterion must be present in each score sheet.
 select count(*) into v_missing
 from public.scores s
 join public.competition_groups g on g.id=s.group_id
 where s.group_id=p_group and s.grader_id=p_grader
 and exists(
   select 1 from jsonb_array_elements(g.criteria) c
   where (not exists(select 1 from public.gs_criterion_grants ag where ag.grader_id=p_grader and ag.group_id=p_group)
      or exists(select 1 from public.gs_criterion_grants ag where ag.grader_id=p_grader and ag.group_id=p_group and ag.criterion=c->>'name'))
     and not (s.scores ? (c->>'name'))
 );
 if v_missing>0 then return jsonb_build_object('ok',false,'code','INCOMPLETE_CRITERIA','records',v_missing);end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'candidateId',s.candidate_id,'scores',s.scores,'total',s.total_score,
  'revision',s.revision) order by s.candidate_id),'[]'::jsonb)
 into v_snapshot from public.scores s where s.group_id=p_group and s.grader_id=p_grader;
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 update public.scores set locked=true,submitted_at=now(),updated_at=now()
 where group_id=p_group and grader_id=p_grader and locked=false;
 insert into public.gs_grading_receipts(grader_id,group_id,email,grader_name,verified_at,snapshot,snapshot_sha256)
 select p_grader,p_group,a.email,v_profile.name,now(),v_snapshot,v_hash
 from public.gs_google_grader_access a where a.profile_id=p_grader and a.enabled=true;
 if not found then return jsonb_build_object('ok',false,'code','GOOGLE_NOT_INVITED');end if;
 insert into public.grader_verifications(group_id,grader_id,grader_code,grader_name,is_verified,signed_at,updated_at)
 values(p_group,p_grader,v_profile.code,v_profile.name,true,now(),now())
 on conflict(group_id,grader_id) do update set is_verified=true,signed_at=now(),updated_at=now();
 update public.gs_otp_challenges set used_at=now() where grader_id=p_grader and group_id=p_group;
 return jsonb_build_object('ok',true,'sha256',v_hash,'confirmedAt',now());
end
$$;
revoke all on function public.gs_issue_grading_otp(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.gs_finalize_grading_otp(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gs_issue_grading_otp(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.gs_finalize_grading_otp(uuid,uuid,text) to service_role;
