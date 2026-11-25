-- Durable receipt email events; never expose private payloads to clients.
create table public.osc_receipt_mail_jobs (
 id uuid primary key default gen_random_uuid(),
 group_id uuid not null, grader_id uuid not null,
 comparison_code text not null check(comparison_code ~ '^[0-9]{8}$'),
 kind text not null check(kind in ('completion','reopen')),
 email text not null, grader_name text not null, group_name text not null,
 confirmed_at timestamptz not null, reason text not null default '',
 status text not null default 'pending' check(status in ('pending','sending','sent','failed','cancelled')),
 attempts integer not null default 0, next_at timestamptz not null default now(),
 lease_until timestamptz, pdf_sha256 text, sent_at timestamptz, last_error text,
 created_at timestamptz not null default now(),
 unique(comparison_code,kind)
);
alter table public.osc_receipt_mail_jobs enable row level security;
revoke all on public.osc_receipt_mail_jobs from public,anon,authenticated;
grant select,insert,update on public.osc_receipt_mail_jobs to service_role;
create index osc_receipt_mail_pending on public.osc_receipt_mail_jobs(next_at) where status in ('pending','failed','sending');
alter table public.gs_reopened_score_sheets add column if not exists reason text,add column if not exists actor_uid text;
grant select on public.gs_reopened_score_sheets to service_role;

create or replace function public.osc_judge_email_locked(p_grader uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from gradesync_internal.comparison_code_registry where grader_id=p_grader)
 or exists(select 1 from public.gs_grading_receipts where grader_id=p_grader)
 or exists(select 1 from public.gs_reopened_score_sheets where grader_id=p_grader)
$$;
revoke all on function public.osc_judge_email_locked(uuid) from public,anon,authenticated;
grant execute on function public.osc_judge_email_locked(uuid) to service_role;
create or replace function public.osc_locked_judge_ids()
returns table(grader_id uuid) language sql stable security definer set search_path='' as $$
 select r.grader_id from gradesync_internal.comparison_code_registry r union select r.grader_id from public.gs_grading_receipts r union select r.grader_id from public.gs_reopened_score_sheets r
$$;
revoke all on function public.osc_locked_judge_ids() from public,anon,authenticated;
grant execute on function public.osc_locked_judge_ids() to service_role;
create or replace function gradesync_internal.guard_signed_judge_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and new.email is not distinct from old.email and new.auth_user_id is not distinct from old.auth_user_id and new.profile_id=old.profile_id then return new;end if;
 if public.osc_judge_email_locked(old.profile_id) then raise exception 'GS_JUDGE_EMAIL_LOCKED';end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function gradesync_internal.guard_signed_judge_email() from public,anon,authenticated;
create trigger gs_signed_judge_email_guard before update or delete on public.gs_google_grader_access for each row execute function gradesync_internal.guard_signed_judge_email();

create or replace function gradesync_internal.queue_receipt_email()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.comparison_code is not null and new.confirmation_method='email-otp' then
 insert into public.osc_receipt_mail_jobs(group_id,grader_id,comparison_code,kind,email,grader_name,group_name,confirmed_at)
 select new.group_id,new.grader_id,new.comparison_code,'completion',new.email,new.grader_name,g.name,new.verified_at from public.competition_groups g where g.id=new.group_id on conflict do nothing;
 end if;
 return new;
end $$;
revoke all on function gradesync_internal.queue_receipt_email() from public,anon,authenticated;
create trigger gs_receipt_mail_queue after insert on public.gs_grading_receipts for each row execute function gradesync_internal.queue_receipt_email();

-- No legacy UI, direct DELETE, or update to false may bypass the mandatory reopen.
drop trigger gs_reopen_verified_sheet on public.grader_verifications;
create or replace function gradesync_internal.guard_receipt_revocation()
returns trigger language plpgsql security definer set search_path='' as $$
declare gid uuid:=old.group_id; uid uuid:=old.grader_id;
begin
 if tg_op='UPDATE' then
 if new.is_verified is not distinct from old.is_verified and new.group_id=gid and new.grader_id=uid then return new;end if;
 if not old.is_verified then return new;end if;
 end if;
 if current_setting('osc.delete_session_scope',true)=gid::text or current_setting('osc.reopen_receipt_scope',true)=gid::text||':'||uid::text then
 if tg_op='DELETE' then return old;end if;return new;
 end if;
 if tg_table_name='grader_verifications' and not old.is_verified then if tg_op='DELETE' then return old;end if;return new;end if;
 raise exception 'GS_REOPEN_RPC_REQUIRED';
end $$;
revoke all on function gradesync_internal.guard_receipt_revocation() from public,anon,authenticated;
create trigger gs_verification_reopen_guard before delete or update on public.grader_verifications for each row execute function gradesync_internal.guard_receipt_revocation();
create trigger gs_receipt_reopen_guard before delete on public.gs_grading_receipts for each row execute function gradesync_internal.guard_receipt_revocation();

create or replace function public.osc_reopen_receipt(p_group uuid,p_grader uuid,p_code text,p_reason text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
end $$;
revoke all on function public.osc_reopen_receipt(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.osc_reopen_receipt(uuid,uuid,text,text,text) to service_role;
create or replace function public.osc_receipt_code_status(p_code text)
returns text language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.gs_grading_receipts where comparison_code=p_code) then 'active'
 when exists(select 1 from gradesync_internal.comparison_code_registry where code=p_code) or exists(select 1 from public.gs_reopened_score_sheets where receipt->>'comparison_code'=p_code) then 'superseded'
 else 'unknown' end
$$;
revoke all on function public.osc_receipt_code_status(text) from public,anon,authenticated;
grant execute on function public.osc_receipt_code_status(text) to service_role;

create or replace function public.osc_claim_receipt_mail(p_id uuid,p_resend boolean default false)
returns setof public.osc_receipt_mail_jobs language plpgsql security invoker set search_path='' as $$
declare j public.osc_receipt_mail_jobs%rowtype;
begin
 select * into j from public.osc_receipt_mail_jobs where id=p_id for update;
 if not found or j.status='cancelled' or (j.status='sending' and j.lease_until>now()) or (j.status='sent' and not p_resend) then return;end if;
 if j.kind='completion' and not exists(select 1 from public.gs_grading_receipts r where r.group_id=j.group_id and r.grader_id=j.grader_id and r.comparison_code=j.comparison_code) then
 update public.osc_receipt_mail_jobs set status='cancelled',lease_until=null where id=j.id;return;
 end if;
 if p_resend and j.status='sent' and j.sent_at>now()-interval '60 seconds' then return;end if;
 if not p_resend and (j.next_at>now() or j.attempts>=8) then return;end if;
 return query update public.osc_receipt_mail_jobs set status='sending',lease_until=now()+interval '2 minutes',attempts=attempts+1,last_error=null where id=j.id returning *;
end $$;
revoke all on function public.osc_claim_receipt_mail(uuid,boolean) from public,anon,authenticated;
grant execute on function public.osc_claim_receipt_mail(uuid,boolean) to service_role;
notify pgrst,'reload schema';