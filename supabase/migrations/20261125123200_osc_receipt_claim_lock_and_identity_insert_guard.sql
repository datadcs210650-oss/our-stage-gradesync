CREATE OR REPLACE FUNCTION public.osc_claim_receipt_mail(p_id uuid, p_resend boolean DEFAULT false)
 RETURNS SETOF osc_receipt_mail_jobs
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.osc_receipt_mail_jobs%rowtype; gid uuid;
begin
 select group_id into gid from public.osc_receipt_mail_jobs where id=p_id;
 if not found then return;end if;
 perform 1 from public.competition_groups where id=gid for share;
 select * into j from public.osc_receipt_mail_jobs where id=p_id for update;
 if not found or j.status='cancelled' or (j.status='sending' and j.lease_until>now()) or (j.status='sent' and not p_resend) then return;end if;
 if j.kind='completion' and not exists(select 1 from public.gs_grading_receipts r where r.group_id=j.group_id and r.grader_id=j.grader_id and r.comparison_code=j.comparison_code) then
 update public.osc_receipt_mail_jobs set status='cancelled',lease_until=null where id=j.id;return;
 end if;
 if p_resend and j.status='sent' and j.sent_at>now()-interval '60 seconds' then return;end if;
 if not p_resend and (j.next_at>now() or j.attempts>=8) then return;end if;
 return query update public.osc_receipt_mail_jobs set status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1,last_error=null where id=j.id returning *;
end $function$;
create or replace function gradesync_internal.guard_signed_judge_insert()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if public.osc_judge_email_locked(new.profile_id) and not exists(select 1 from public.gs_google_grader_access a where a.profile_id=new.profile_id and a.email=new.email and a.auth_user_id is not distinct from new.auth_user_id) then raise exception 'GS_JUDGE_EMAIL_LOCKED';end if;
 return new;
end $$;
revoke all on function gradesync_internal.guard_signed_judge_insert() from public,anon,authenticated;
create trigger gs_signed_judge_insert_guard before insert on public.gs_google_grader_access for each row execute function gradesync_internal.guard_signed_judge_insert();
notify pgrst,'reload schema';