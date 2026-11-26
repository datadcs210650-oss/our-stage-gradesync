-- Attendance is permanently locked once at least half of the assigned BGK submit OTP.
create table if not exists gradesync_internal.attendance_locks(
 group_id uuid primary key references public.competition_groups(id) on delete cascade,
 locked_at timestamptz not null default now(), assigned_count integer not null, submitted_count integer not null
);
revoke all on gradesync_internal.attendance_locks from public,anon,authenticated;
alter table gradesync_internal.attendance_locks enable row level security;
create or replace function gradesync_internal.attendance_enabled(p_group uuid) returns boolean
language sql stable set search_path='' as $$
 select coalesce((select extra_data->'attendanceEnabled'='true'::jsonb from public.competition_groups where id=p_group),false)
$$;
create or replace function gradesync_internal.attendance_eligible(p_candidate uuid) returns boolean
language sql stable set search_path='' as $$
 select coalesce((select not gradesync_internal.attendance_enabled(group_id) or is_present is true from public.candidates where id=p_candidate),false)
$$;
create or replace function gradesync_internal.attendance_counts(p_group uuid) returns table(assigned_count integer,submitted_count integer)
language sql stable set search_path='' as $$
 select count(*)::int,count(*) filter(where exists(select 1 from public.gs_grading_receipts r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.profiles p on p.id=r.grader_id and p.role='Grader' and p.status='Active' where r.group_id=a.group_id and r.grader_id=a.grader_id and r.confirmation_method='email-otp' and r.comparison_code ~ '^[0-9]{8}$' and r.snapshot_sha256 ~ '^[a-f0-9]{64}$'))::int from public.grader_assignments a where a.group_id=p_group
$$;
create or replace function public.osc_attendance_state(p_group uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('enabled',gradesync_internal.attendance_enabled(p_group),'locked',exists(select 1 from gradesync_internal.attendance_locks where group_id=p_group),'lockedAt',(select locked_at from gradesync_internal.attendance_locks where group_id=p_group),'assigned',n.assigned_count,'submitted',n.submitted_count) from gradesync_internal.attendance_counts(p_group) n
$$;
revoke all on function public.osc_attendance_state(uuid) from public,anon,authenticated;
grant execute on function public.osc_attendance_state(uuid) to service_role;
create or replace function gradesync_internal.lock_attendance_on_submission() returns trigger
language plpgsql security definer set search_path='' as $$
declare n record;
begin
 if not new.is_verified or not gradesync_internal.attendance_enabled(new.group_id) then return new; end if;
 perform 1 from public.competition_groups where id=new.group_id for update;
 select * into n from gradesync_internal.attendance_counts(new.group_id);
 if n.assigned_count>0 and n.submitted_count*2>=n.assigned_count then
  insert into gradesync_internal.attendance_locks(group_id,assigned_count,submitted_count) values(new.group_id,n.assigned_count,n.submitted_count) on conflict do nothing;
  if found then insert into public.audit_logs(group_id,action,details) values(new.group_id,'attendance-locked',jsonb_build_object('assigned',n.assigned_count,'submitted',n.submitted_count));end if;
 end if;
 return new;
end $$;
drop trigger if exists gs_lock_attendance_on_submission on public.grader_verifications;
create trigger gs_lock_attendance_on_submission after insert or update of is_verified on public.grader_verifications for each row execute function gradesync_internal.lock_attendance_on_submission();
-- Existing attendance: do not reset any historical presence or score.
insert into gradesync_internal.attendance_locks(group_id,assigned_count,submitted_count)
select g.id,n.assigned_count,n.submitted_count from public.competition_groups g cross join lateral gradesync_internal.attendance_counts(g.id) n
where gradesync_internal.attendance_enabled(g.id) and n.assigned_count>0 and n.submitted_count*2>=n.assigned_count
on conflict do nothing;
create or replace function gradesync_internal.guard_attendance_candidate() returns trigger
language plpgsql security definer set search_path='' as $$
declare gid uuid; changed boolean;
begin
 gid:=case when tg_op='DELETE' then old.group_id else new.group_id end;
 if tg_op='DELETE' and current_setting('osc.delete_session_scope',true)=gid::text then return old;end if;
 if tg_op='UPDATE' and old.group_id is distinct from new.group_id then raise exception 'GS_CANDIDATE_GROUP_IMMUTABLE';end if;
 changed:=tg_op<>'UPDATE' or new.is_present is distinct from old.is_present or new.attendance_order is distinct from old.attendance_order;
 if not changed then return new;end if;
 perform 1 from public.competition_groups where id=gid for update;
 if not found and tg_op='DELETE' then return old;end if;
 if gradesync_internal.attendance_enabled(gid) then
  if exists(select 1 from gradesync_internal.attendance_locks where group_id=gid) then raise exception 'GS_ATTENDANCE_LOCKED';end if;
  if tg_op='INSERT' then new.is_present:=false;new.attendance_order:=0;
  elsif tg_op='UPDATE' and new.is_present is distinct from old.is_present then
   if exists(select 1 from public.gs_casting_decisions where candidate_id=old.id and review_status<>'pending') then raise exception 'GS_ATTENDANCE_REVIEWED';end if;
   insert into public.audit_logs(group_id,candidate_id,action,details) values(gid,new.id,'attendance-changed',jsonb_build_object('from',old.is_present,'to',new.is_present));
  end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $$;
drop trigger if exists gs_attendance_candidate_guard on public.candidates;
create trigger gs_attendance_candidate_guard before insert or update or delete on public.candidates for each row execute function gradesync_internal.guard_attendance_candidate();
create or replace function gradesync_internal.guard_attendance_config() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if coalesce(new.extra_data->'attendanceEnabled','false'::jsonb) is distinct from coalesce(old.extra_data->'attendanceEnabled','false'::jsonb) then
  if exists(select 1 from gradesync_internal.attendance_locks where group_id=old.id) or gradesync_internal.group_has_grading_history(old.id) then raise exception 'GS_ATTENDANCE_CONFIG_LOCKED';end if;
 end if;return new;
end $$;
create or replace function gradesync_internal.initialize_attendance() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.extra_data->'attendanceEnabled'='true'::jsonb and old.extra_data->'attendanceEnabled' is distinct from 'true'::jsonb then
  update public.candidates set is_present=false,attendance_order=0,attendance_updated_at=now() where group_id=new.id and (is_present or attendance_order<>0);
 end if;return new;
end $$;
drop trigger if exists gs_attendance_config_guard on public.competition_groups;
create trigger gs_attendance_config_guard before update on public.competition_groups for each row execute function gradesync_internal.guard_attendance_config();
drop trigger if exists gs_initialize_attendance on public.competition_groups;
create trigger gs_initialize_attendance after update on public.competition_groups for each row execute function gradesync_internal.initialize_attendance();
create or replace function gradesync_internal.guard_absent_score() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if not gradesync_internal.attendance_enabled(new.group_id) then return new;end if;
 if tg_op='UPDATE' and new.scores is not distinct from old.scores and new.total_score is not distinct from old.total_score and new.extra_data is not distinct from old.extra_data and new.group_id=old.group_id and new.candidate_id=old.candidate_id and new.grader_id=old.grader_id then return new;end if;
 if not exists(select 1 from public.candidates where id=new.candidate_id and group_id=new.group_id and is_present) then raise exception 'GS_CANDIDATE_ABSENT';end if;
 return new;
end $$;
drop trigger if exists b_gs_guard_absent_score on public.scores;
create trigger b_gs_guard_absent_score before insert or update on public.scores for each row execute function gradesync_internal.guard_absent_score();
create or replace function gradesync_internal.guard_attendance_signal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if gradesync_internal.attendance_enabled(new.group_id) and not exists(select 1 from public.candidates c where c.id=new.candidate_id and c.group_id=new.group_id and c.is_present is not distinct from new.is_present) then raise exception 'GS_ATTENDANCE_SIGNAL_MISMATCH';end if;
 return new;
end $$;
drop trigger if exists gs_attendance_signal_guard on public.attendance_realtime;
create trigger gs_attendance_signal_guard before insert or update on public.attendance_realtime for each row execute function gradesync_internal.guard_attendance_signal();

CREATE OR REPLACE FUNCTION public.osc_candidate_quorum(p_casting uuid)
 RETURNS TABLE(candidate_id uuid, group_id uuid, expected_count integer, submitted_count integer, valid_ids uuid[], covered boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with grp as (select g.id,g.criteria from public.competition_groups g where g.casting_id=p_casting),
 roster as (select a.group_id,a.grader_id from public.grader_assignments a join grp g on g.id=a.group_id),
 verified as (select distinct r.group_id,r.grader_id from roster r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.gs_grading_receipts gr on gr.group_id=r.group_id and gr.grader_id=r.grader_id and gr.confirmation_method='email-otp' and gr.comparison_code ~ '^[0-9]{8}$' and gr.snapshot_sha256 ~ '^[a-f0-9]{64}$' join public.profiles p on p.id=r.grader_id and p.status='Active' and p.role='Grader'),
 valid as (
 select s.candidate_id,s.group_id,s.grader_id,s.scores from public.scores s
 join verified v on v.group_id=s.group_id and v.grader_id=s.grader_id join grp g on g.id=s.group_id
 where s.locked is true and s.total_score between 0 and 10
 and exists(select 1 from jsonb_array_elements(g.criteria) k where not exists(select 1 from public.gs_criterion_grants a where a.group_id=s.group_id and a.grader_id=s.grader_id) or exists(select 1 from public.gs_criterion_grants a where a.group_id=s.group_id and a.grader_id=s.grader_id and a.criterion=k->>'name'))
 and not exists(select 1 from jsonb_array_elements(g.criteria) k
 where (not exists(select 1 from public.gs_criterion_grants a where a.group_id=s.group_id and a.grader_id=s.grader_id) or exists(select 1 from public.gs_criterion_grants a where a.group_id=s.group_id and a.grader_id=s.grader_id and a.criterion=k->>'name'))
 and case when jsonb_typeof(s.scores->(k->>'name'))='number' then (s.scores->>(k->>'name'))::numeric not between 0 and 10 else true end)
 )
 select c.id,c.group_id,(select count(*)::integer from roster r where r.group_id=c.group_id),
 (select count(*)::integer from verified v where v.group_id=c.group_id),
 array(select distinct v.grader_id from valid v where v.candidate_id=c.id and v.group_id=c.group_id),
 not exists(select 1 from jsonb_array_elements(g.criteria) k where not exists(select 1 from valid v where v.candidate_id=c.id and v.group_id=c.group_id and v.scores ? (k->>'name')))
 from public.candidates c join grp g on g.id=c.group_id where gradesync_internal.attendance_eligible(c.id)
$function$;

CREATE OR REPLACE FUNCTION gradesync_internal.assert_candidate_majority(p_casting uuid, p_candidate uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q record;
begin
 select * into q from public.osc_candidate_quorum(p_casting) x where x.candidate_id=p_candidate;
 if not found or q.expected_count=0 or q.submitted_count*2<q.expected_count or cardinality(q.valid_ids)*2<q.expected_count or not q.covered then
  raise exception 'GS_MAJORITY_REQUIRED';
 end if;
end
$function$;

CREATE OR REPLACE FUNCTION gradesync_internal.guard_approval_capacity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.competition_groups%rowtype; lim jsonb; role_name text; cap integer; used integer; max_roles integer;
begin
 if new.review_status<>'approved' then return new; end if;
 if tg_op='UPDATE' and new.review_status=old.review_status and new.assigned_roles=old.assigned_roles and new.score is not distinct from old.score and new.outcome=old.outcome and new.reviewed_at is not distinct from old.reviewed_at then return new;end if;
 select x.* into g from public.competition_groups x join public.candidates c on c.group_id=x.id where c.id=new.candidate_id for update of x;
 if not found or g.casting_id is distinct from new.casting_id then raise exception 'CASTING_CANDIDATE_MISMATCH';end if;
 if not gradesync_internal.attendance_eligible(new.candidate_id) then raise exception 'GS_CANDIDATE_ABSENT';end if;
 perform gradesync_internal.assert_candidate_majority(new.casting_id,new.candidate_id);
 lim:=coalesce(g.extra_data->'gsRoleLimits','{}'::jsonb);
 max_roles:=coalesce((lim->>'maxOfficialRoles')::integer,1);
 if cardinality(new.assigned_roles)>max_roles then raise exception 'GS_OFFICIAL_ROLE_LIMIT';end if;
 if cardinality(new.assigned_roles)>0 and new.outcome<>'passed' then raise exception 'GS_ROLE_REQUIRES_PASS';end if;
 foreach role_name in array new.assigned_roles loop
  cap:=coalesce((lim->'capacity'->>role_name)::integer,1);
  select count(*) into used from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=g.id and gradesync_internal.attendance_eligible(c.id) and d.candidate_id<>new.candidate_id and d.review_status='approved' and d.outcome='passed' and role_name=any(d.assigned_roles);
  if used>=cap then raise exception 'GS_ROLE_CAPACITY';end if;
 end loop;
 return new;
end
$function$;

CREATE OR REPLACE FUNCTION gradesync_internal.guard_casting_publication_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.competition_groups%rowtype; r record; lim jsonb; role_name text; used integer;
begin
 if new.status<>'published' or old.status='published' then return new;end if;
 for g in select * from public.competition_groups where casting_id=new.id order by id for update loop
  lim:=coalesce(g.extra_data->'gsRoleLimits','{}'::jsonb);
  for r in select c.id,d.review_status,d.outcome,d.assigned_roles from public.candidates c left join public.gs_casting_decisions d on d.candidate_id=c.id and d.casting_id=new.id where c.group_id=g.id and gradesync_internal.attendance_eligible(c.id) loop
   if r.review_status is distinct from 'approved' then raise exception 'GS_PUBLICATION_PENDING';end if;
   perform gradesync_internal.assert_candidate_majority(new.id,r.id);
   if r.review_status='approved' and (cardinality(r.assigned_roles)>coalesce((lim->>'maxOfficialRoles')::integer,1) or (cardinality(r.assigned_roles)>0 and r.outcome<>'passed')) then raise exception 'GS_OFFICIAL_ROLE_LIMIT';end if;
  end loop;
  for role_name in select jsonb_array_elements_text(coalesce(g.extra_data->'gsCasting'->'roles','[]'::jsonb)) loop
   select count(*) into used from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=g.id and gradesync_internal.attendance_eligible(c.id) and d.review_status='approved' and d.outcome='passed' and role_name=any(d.assigned_roles);
   if used>coalesce((lim->'capacity'->>role_name)::integer,1) then raise exception 'GS_ROLE_CAPACITY';end if;
  end loop;
 end loop;
 if not exists(select 1 from public.gs_casting_decisions d where d.casting_id=new.id and gradesync_internal.attendance_eligible(d.candidate_id) and d.review_status='approved') then raise exception 'GS_PUBLICATION_PENDING';end if;
 return new;
end
$function$;

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
 select count(*) into v_total from public.candidates where group_id=p_group and gradesync_internal.attendance_eligible(id);
 if v_total=0 then return jsonb_build_object('ok',false,'code','NO_PRESENT_CANDIDATES');end if;
 select count(*) into v_count from public.scores s
   where s.group_id=p_group and s.grader_id=p_grader
   and gradesync_internal.attendance_eligible(s.candidate_id)
   and jsonb_typeof(s.scores)='object' and s.scores <> '{}'::jsonb;
 select count(*) into v_missing
 from public.candidates c join public.competition_groups g on g.id=c.group_id
 cross join lateral jsonb_array_elements(g.criteria) cr
 left join public.scores s on s.candidate_id=c.id and s.group_id=p_group
     and s.grader_id=p_grader
 where c.group_id=p_group and gradesync_internal.attendance_eligible(c.id)
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
 where s.group_id=p_group and s.grader_id=p_grader and gradesync_internal.attendance_eligible(s.candidate_id);
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 update public.scores set locked=true,submitted_at=now(),updated_at=now()
 where group_id=p_group and grader_id=p_grader and locked=false and gradesync_internal.attendance_eligible(candidate_id);
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

notify pgrst,'reload schema';

revoke execute on function gradesync_internal.attendance_enabled(uuid),gradesync_internal.attendance_eligible(uuid),gradesync_internal.attendance_counts(uuid) from public,anon,authenticated;
grant execute on function gradesync_internal.attendance_enabled(uuid),gradesync_internal.attendance_eligible(uuid),gradesync_internal.attendance_counts(uuid) to service_role;
