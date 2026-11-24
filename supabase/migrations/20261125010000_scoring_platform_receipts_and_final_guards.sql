
-- Additive receipt identifiers; existing historical receipts remain truthful
-- (NULL = issued before the new 8-digit code policy).
alter table public.gs_grading_receipts add column if not exists comparison_code text;
alter table public.gs_grading_receipts add constraint gs_receipt_comparison_code_format check (comparison_code is null or comparison_code ~ '^[0-9]{8}$');
create unique index gs_receipt_comparison_code_unique on public.gs_grading_receipts(comparison_code) where comparison_code is not null;
create table gradesync_internal.comparison_code_registry (
 code text primary key check (code ~ '^[0-9]{8}$'),
 grader_id uuid not null, group_id uuid not null, issued_at timestamptz not null default now()
);
alter table gradesync_internal.comparison_code_registry enable row level security;
revoke all on gradesync_internal.comparison_code_registry from public,anon,authenticated,service_role;
create or replace function gradesync_internal.allocate_comparison_code()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,gradesync_internal as $$
declare v_code text; i int;
begin
 if new.comparison_code is not null then raise exception 'COMPARISON_CODE_SERVER_ONLY';end if;
 for i in 1..50 loop
  v_code:=lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 100000000)::text,8,'0');
  insert into gradesync_internal.comparison_code_registry(code,grader_id,group_id) values(v_code,new.grader_id,new.group_id) on conflict do nothing;
  if found then new.comparison_code:=v_code;return new;end if;
 end loop;
 raise exception 'COMPARISON_CODE_ALLOCATION_FAILED';
end $$;
revoke all on function gradesync_internal.allocate_comparison_code() from public,anon,authenticated;
create trigger gs_receipt_allocate_code before insert on public.gs_grading_receipts for each row execute function gradesync_internal.allocate_comparison_code();

-- Both the verified identity and a verified OAuth session are required. A
-- legacy password token has no access even if it still exists in auth.users.
create or replace function gradesync_internal.google_oauth_session()
returns boolean language sql stable set search_path=pg_catalog,auth as $$
 select coalesce((select auth.jwt())->'app_metadata'->>'provider','')='google'
 and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
$$;
revoke all on function gradesync_internal.google_oauth_session() from public,anon,authenticated;
create or replace function public.gs_current_grader_id()
returns uuid language sql stable security definer set search_path=pg_catalog,public,auth as $$
 select a.profile_id from public.gs_google_grader_access a
 join public.profiles p on p.id=a.profile_id
 join auth.users u on u.id=a.auth_user_id
 where a.auth_user_id=(select auth.uid()) and a.enabled=true
 and p.role='Grader' and p.status='Active'
 and u.email_confirmed_at is not null and lower(trim(u.email))=a.email
 and gradesync_internal.google_oauth_session()
 and exists(select 1 from auth.identities i where i.user_id=u.id and i.provider='google')
 limit 1
$$;
CREATE OR REPLACE FUNCTION public.gs_claim_google_grader()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare v_uid uuid:=auth.uid();v_email text;v_auth uuid;v_p public.profiles%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 if not gradesync_internal.google_oauth_session() then raise exception 'GOOGLE_VERIFICATION_REQUIRED';end if;
 select lower(trim(u.email)),u.id into v_email,v_auth
 from auth.users u where u.id=v_uid and u.email_confirmed_at is not null
 and exists(select 1 from auth.identities i where i.user_id=v_uid and i.provider='google');
 if v_email is null then raise exception 'GOOGLE_VERIFICATION_REQUIRED'; end if;
 select p.* into v_p from public.gs_google_grader_access a
 join public.profiles p on p.id=a.profile_id
 where a.email=v_email and a.enabled=true and p.role='Grader' and p.status='Active'
   and (a.auth_user_id is null or a.auth_user_id=v_uid) for update of p;
 if not found then raise exception 'GOOGLE_EMAIL_NOT_INVITED'; end if;
 update public.gs_google_grader_access set auth_user_id=v_uid,updated_at=now()
 where profile_id=v_p.id and (auth_user_id is null or auth_user_id=v_uid);
 if not found then raise exception 'GOOGLE_ACCOUNT_ALREADY_LINKED'; end if;
 return jsonb_build_object('id',v_p.id,'code',v_p.code,'name',v_p.name,'email',v_email,
   'role','Grader','status',v_p.status,'assignedGroups',v_p.assigned_groups,
   'allowedMenus',v_p.allowed_menus);
end;
$function$;
create or replace function public.is_grader_assigned(target_group_id uuid)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth as $$
 select exists(select 1 from public.grader_assignments a where a.grader_id=public.gs_current_grader_id() and a.group_id=target_group_id)
$$;
create policy "gs_google_oauth_required" on public.scores as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.profiles as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.competition_groups as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.candidates as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.grader_assignments as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.grader_verifications as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.gs_criterion_grants as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.attendance as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.attendance_realtime as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.group_publication_index as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.grader_sessions as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.submission_notifications as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.audit_logs as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);
create policy "gs_google_oauth_required" on public.admin_sessions as restrictive for all to authenticated using ((select public.gs_current_grader_id()) is not null) with check ((select public.gs_current_grader_id()) is not null);

-- Final publication guard, including service-role writes. Check both old and
-- new scope to prevent moving rows out of a published session. Only sync
-- bookkeeping and consent withdrawal are allowed to change after publication.
create or replace function gradesync_internal.guard_completed_session()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,gradesync_internal as $$
declare oldj jsonb:='{}'; newj jsonb:='{}'; rowj jsonb; cid uuid; gid uuid; st text;
begin
 if tg_op<>'INSERT' then oldj:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then newj:=to_jsonb(new);end if;
 if tg_table_name='gs_castings' then
  if oldj->>'status' in ('published','archived') then
   if tg_op='UPDATE' and (oldj-'status'-'updated_at')=(newj-'status'-'updated_at')
      and (newj->>'status'=oldj->>'status' or (oldj->>'status'='published' and newj->>'status'='archived')) then return new;end if;
   raise exception 'Phiên chấm đã hoàn tất.';
  end if;
 elsif tg_table_name='gs_grading_receipts' and tg_op='UPDATE' then
  raise exception 'Biên bản xác nhận đã khóa.';
 else
  for rowj in select oldj union all select newj loop
   cid:=null;gid:=null;
   if tg_table_name in ('gs_casting_decisions','gs_candidate_identity','gs_candidate_fields','competition_groups') then
    cid:=(rowj->>'casting_id')::uuid;
   else
    gid:=(rowj->>'group_id')::uuid;
    if gid is not null then select casting_id into cid from public.competition_groups where id=gid;end if;
   end if;
   if cid is not null then
    select status into st from public.gs_castings where id=cid for share;
    if st in ('published','archived') then
     if tg_table_name='gs_casting_decisions' and tg_op='UPDATE'
       and (oldj-'synced_at'-'member_id'-'updated_at')=(newj-'synced_at'-'member_id'-'updated_at') then return new;end if;
     if tg_table_name='gs_candidate_identity' and tg_op='UPDATE'
       and (oldj-'email_consent'-'updated_at')=(newj-'email_consent'-'updated_at') and newj->>'email_consent'='false' then return new;end if;
     raise exception 'Phiên chấm đã hoàn tất.';
    end if;
   end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
revoke all on function gradesync_internal.guard_completed_session() from public,anon,authenticated;
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_castings for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.competition_groups for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.grader_assignments for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_criterion_grants for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.scores for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.candidates for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.grader_verifications for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_grading_receipts for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_casting_decisions for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_candidate_identity for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.gs_candidate_fields for each row execute function gradesync_internal.guard_completed_session();
create trigger zz_gs_completed_guard before insert or update or delete on public.group_publication_index for each row execute function gradesync_internal.guard_completed_session();
CREATE OR REPLACE FUNCTION public.gs_finalize_grading_otp(p_grader uuid, p_group uuid, p_digest text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 ch public.gs_otp_challenges%rowtype;
 v_profile public.profiles%rowtype;
 v_snapshot jsonb;v_hash text;
 v_total integer;v_count integer;v_missing integer;
 v_completeness jsonb; v_code text; v_confirmed timestamptz; v_casting uuid; v_status text; v_email text;
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

 -- Serialize the snapshot with concurrent score writes (which take a group share lock).
 select casting_id into v_casting from public.competition_groups where id=p_group for update;
 if not found then return jsonb_build_object('ok',false,'code','GROUP_NOT_FOUND');end if;
 if v_casting is not null then
  select status into v_status from public.gs_castings where id=v_casting for share;
  if v_status in ('published','archived','approved') then return jsonb_build_object('ok',false,'code','SESSION_FINAL');end if;
 end if;
 -- Verify access before any score write.
 select a.email into v_email from public.gs_google_grader_access a
 where a.profile_id=p_grader and a.enabled=true and a.auth_user_id is not null for share;
 if not found then return jsonb_build_object('ok',false,'code','GOOGLE_NOT_INVITED');end if;
 if exists(select 1 from public.gs_grading_receipts where grader_id=p_grader and group_id=p_group)
 then return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED');end if;
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
  'total',s.total_score,'revision',s.revision) || case when s.extra_data ? 'gsProposedRoles' or s.extra_data ? 'gsJudgeNote' then jsonb_build_object('proposedRoles',coalesce(s.extra_data->'gsProposedRoles','[]'::jsonb),'note',coalesce(s.extra_data->>'gsJudgeNote','')) else '{}'::jsonb end order by s.candidate_id),'[]'::jsonb)
 into v_snapshot from public.scores s
 where s.group_id=p_group and s.grader_id=p_grader;
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 update public.scores set locked=true,submitted_at=now(),updated_at=now()
 where group_id=p_group and grader_id=p_grader and locked=false;
 insert into public.gs_grading_receipts(
   grader_id,group_id,email,grader_name,verified_at,snapshot,snapshot_sha256,completeness
 ) values(p_grader,p_group,v_email,v_profile.name,now(),v_snapshot,v_hash,v_completeness)
 returning comparison_code,verified_at into v_code,v_confirmed;
 insert into public.grader_verifications(
  group_id,grader_id,grader_code,grader_name,is_verified,signed_at,updated_at
 ) values(p_group,p_grader,v_profile.code,v_profile.name,true,now(),now())
 on conflict(group_id,grader_id) do update
  set is_verified=true,signed_at=now(),updated_at=now();
 update public.gs_otp_challenges set used_at=now()
 where grader_id=p_grader and group_id=p_group;
 return jsonb_build_object('ok',true,'sha256',v_hash,'confirmedAt',now(),
  'completeness',v_completeness,'comparisonCode',v_code);
end
$function$;
revoke all on function public.gs_finalize_grading_otp(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gs_finalize_grading_otp(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
