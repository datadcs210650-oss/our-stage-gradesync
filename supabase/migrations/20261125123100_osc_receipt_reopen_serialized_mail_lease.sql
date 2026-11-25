CREATE OR REPLACE FUNCTION public.osc_reopen_receipt(p_group uuid, p_grader uuid, p_code text, p_reason text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.competition_groups%rowtype;r public.gs_grading_receipts%rowtype;v public.grader_verifications%rowtype;st text;job uuid;
begin
 if length(trim(coalesce(p_reason,''))) not between 3 and 500 or coalesce(p_actor,'')='' then raise exception 'GS_REOPEN_REASON_REQUIRED';end if;
 -- Match OTP lock order to avoid a deadlock with finalization.
 perform 1 from public.gs_otp_challenges where group_id=p_group and grader_id=p_grader for update;
 select * into g from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND';end if;
 select status into st from public.gs_castings where id=g.casting_id for share;
 if st in ('approved','published','archived') or exists(select 1 from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=p_group and (d.review_status<>'pending' or d.synced_at is not null)) then raise exception 'GS_SESSION_FINAL';end if;
 select * into r from public.gs_grading_receipts where group_id=p_group and grader_id=p_grader for update;
 if not found or r.comparison_code is null or r.comparison_code is distinct from p_code then raise exception 'GS_RECEIPT_CHANGED';end if;
 select * into v from public.grader_verifications where group_id=p_group and grader_id=p_grader for update;
 if not found or not v.is_verified then raise exception 'GS_RECEIPT_CHANGED';end if;
 perform 1 from public.osc_receipt_mail_jobs where comparison_code=p_code and kind='completion' for update;
 -- A concurrent send may complete before reopening; never reopen while a send has an active lease.
 if exists(select 1 from public.osc_receipt_mail_jobs where comparison_code=p_code and kind='completion' and status='sending' and lease_until>now()) then raise exception 'GS_MAIL_IN_PROGRESS';end if;
 perform set_config('osc.reopen_receipt_scope',p_group::text||':'||p_grader::text,true);
 insert into public.gs_reopened_score_sheets(grader_id,group_id,verification,receipt,reason,actor_uid) values(p_grader,p_group,to_jsonb(v),to_jsonb(r),trim(p_reason),p_actor);
 delete from public.grader_verifications where group_id=p_group and grader_id=p_grader;
 delete from public.gs_grading_receipts where group_id=p_group and grader_id=p_grader;
 update public.scores set locked=false,submitted_at=null,updated_at=now() where group_id=p_group and grader_id=p_grader and (locked or submitted_at is not null);
 update public.gs_otp_challenges set used_at=now() where group_id=p_group and grader_id=p_grader;
 update public.osc_receipt_mail_jobs set status='cancelled',lease_until=null where comparison_code=p_code and kind='completion' and status<>'sent';
 insert into public.osc_receipt_mail_jobs(group_id,grader_id,comparison_code,kind,email,grader_name,group_name,confirmed_at,reason)
 values(p_group,p_grader,p_code,'reopen',r.email,r.grader_name,g.name,r.verified_at,trim(p_reason)) returning id into job;
 insert into public.audit_logs(group_id,grader_id,action,details) values(p_group,p_grader,'osc-reopen-receipt',jsonb_build_object('actorUid',p_actor,'comparisonCode',p_code,'reason',trim(p_reason)));
 perform set_config('osc.reopen_receipt_scope','',true);
 return jsonb_build_object('ok',true,'jobId',job,'comparisonCode',p_code);
end $function$
