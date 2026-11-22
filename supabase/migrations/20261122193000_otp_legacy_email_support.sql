-- Allow verified legacy BGK with a BCN-issued email as well as linked Google BGK.
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
 if not exists(select 1 from public.gs_google_grader_access where profile_id=p_grader and enabled=true) then return jsonb_build_object('ok',false,'code','GOOGLE_NOT_INVITED');end if;
 insert into public.gs_otp_challenges(grader_id,group_id,otp_digest,expires_at,sent_at,failed_attempts,used_at)
 values(p_grader,p_group,p_digest,p_expires,now(),0,null)
 on conflict(grader_id,group_id) do update set otp_digest=excluded.otp_digest,
 expires_at=excluded.expires_at,sent_at=excluded.sent_at,failed_attempts=0,used_at=null;
 return jsonb_build_object('ok',true);
end
$$;

revoke all on function public.gs_issue_grading_otp(uuid,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.gs_issue_grading_otp(uuid,uuid,text,timestamptz) to service_role;