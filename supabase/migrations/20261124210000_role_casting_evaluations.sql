-- Additive, opt-in role casting: old group/score/decision records are unchanged.
-- Apply before deploying the new role-aware API. Existing RPC remains available.
alter table public.gs_casting_decisions add column if not exists assigned_roles text[] not null default '{}'::text[];

create or replace function gradesync_internal.guard_casting_role_config()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare p jsonb; roles jsonb; r integer; j integer;
begin
 p:=new.extra_data->'gsCasting';
 if tg_op='UPDATE' then
  if p is not distinct from old.extra_data->'gsCasting' then return new; end if;
  if exists(select 1 from public.scores where group_id=old.id)
   or exists(select 1 from public.gs_grading_receipts where group_id=old.id)
   or exists(select 1 from public.gs_casting_decisions where casting_id=old.casting_id)
   or exists(select 1 from public.gs_castings where id=old.casting_id and status in ('published','archived'))
  then raise exception 'GS_SESSION_SCORE_CONFIG_LOCKED'; end if;
 end if;
 if p is null then roles:='[]'::jsonb;r:=0;
 else
  if jsonb_typeof(p)<>'object' or jsonb_typeof(p->'roles') is distinct from 'array'
   or jsonb_typeof(p->'notesEnabled') is distinct from 'boolean'
   or coalesce(p->>'method','') not in ('mean','weighted','trimmed')
   or jsonb_typeof(p->'weights') is distinct from 'object'
  then raise exception 'INVALID_ROLE_CONFIG'; end if;
  roles:=p->'roles';
  if jsonb_array_length(roles)>40 or exists(select 1 from jsonb_array_elements(roles) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and 100)
   or (select count(*) from jsonb_array_elements_text(roles))<>(select count(distinct lower(x)) from jsonb_array_elements_text(roles) x)
  then raise exception 'INVALID_ROLE_NAMES'; end if;
  if jsonb_typeof(p->'maxRegistered') is distinct from 'number' or jsonb_typeof(p->'maxProposed') is distinct from 'number'
   or (p->>'maxRegistered') !~ '^[0-9]+$' or (p->>'maxProposed') !~ '^[0-9]+$' then raise exception 'INVALID_ROLE_LIMIT'; end if;
  r:=(p->>'maxRegistered')::integer;j:=(p->>'maxProposed')::integer;
  if (jsonb_array_length(roles)=0 and (r<>0 or j<>0)) or (jsonb_array_length(roles)>0 and (r<1 or r>jsonb_array_length(roles) or j<1 or j>r))
  then raise exception 'INVALID_ROLE_LIMIT'; end if;
  if exists(select 1 from jsonb_each(p->'weights') x where jsonb_typeof(x.value)<>'number' or (x.value#>>'{}')::numeric<=0 or (x.value#>>'{}')::numeric>100)
  then raise exception 'INVALID_JUDGE_WEIGHTS';end if;
 end if;
 if exists(select 1 from public.candidates c where c.group_id=new.id and
   (not (roles @> coalesce(c.custom_fields->'gsRoleIds','[]'::jsonb)) or jsonb_array_length(coalesce(c.custom_fields->'gsRoleIds','[]'::jsonb))>r))
 then raise exception 'REGISTERED_ROLES_EXIST'; end if;
 return new;
end;
$$;
revoke all on function gradesync_internal.guard_casting_role_config() from public,anon,authenticated;
create trigger gs_guard_casting_role_config before insert or update on public.competition_groups
 for each row execute function gradesync_internal.guard_casting_role_config();

create or replace function gradesync_internal.guard_registered_roles()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare p jsonb; registered jsonb; available jsonb; cast_id uuid;
begin
 if tg_op='UPDATE' and new.group_id=old.group_id and new.custom_fields->'gsRoleIds' is not distinct from old.custom_fields->'gsRoleIds' then return new;end if;
 select extra_data->'gsCasting',casting_id into p,cast_id from public.competition_groups where id=new.group_id for share;
 registered:=coalesce(new.custom_fields->'gsRoleIds','[]'::jsonb); available:=coalesce(p->'roles','[]'::jsonb);
 if jsonb_typeof(registered)<>'array' then raise exception 'INVALID_REGISTERED_ROLES'; end if;
 if jsonb_array_length(registered)>coalesce((p->>'maxRegistered')::integer,0)
  or not (available @> registered)
  or (select count(*) from jsonb_array_elements(registered))<>(select count(distinct x) from jsonb_array_elements_text(registered) x)
 then raise exception 'INVALID_REGISTERED_ROLES';end if;
 if tg_op='UPDATE' and (exists(select 1 from public.scores where candidate_id=old.id)
  or exists(select 1 from public.gs_casting_decisions where candidate_id=old.id)) then
  if new.custom_fields->'gsRoleIds' is distinct from old.custom_fields->'gsRoleIds' then raise exception 'REGISTERED_ROLES_LOCKED';end if;
 end if;
 if exists(select 1 from public.gs_castings where id=cast_id and status in ('published','archived')) then raise exception 'GS_CANDIDATE_PUBLISHED'; end if;
 return new;
end;
$$;
revoke all on function gradesync_internal.guard_registered_roles() from public,anon,authenticated;
create trigger gs_guard_registered_roles before insert or update on public.candidates
 for each row execute function gradesync_internal.guard_registered_roles();

create or replace function gradesync_internal.guard_role_evaluation()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare p jsonb; registered jsonb; proposed jsonb; note text;
begin
 select extra_data->'gsCasting' into p from public.competition_groups where id=new.group_id;
 proposed:=coalesce(new.extra_data->'gsProposedRoles','[]'::jsonb);
 note:=coalesce(new.extra_data->>'gsJudgeNote','');
 if p is null and not (new.extra_data ? 'gsProposedRoles' or new.extra_data ? 'gsJudgeNote') then return new;end if;
 select coalesce(custom_fields->'gsRoleIds','[]'::jsonb) into registered from public.candidates where id=new.candidate_id and group_id=new.group_id for share;
 if registered is null then raise exception 'CANDIDATE_GROUP_MISMATCH';end if;
 if jsonb_typeof(proposed)<>'array' then raise exception 'INVALID_ROLE_EVALUATION';end if;
 if jsonb_array_length(proposed)>coalesce((p->>'maxProposed')::integer,0)
  or not (registered @> proposed) or not (coalesce(p->'roles','[]'::jsonb) @> proposed)
  or (select count(*) from jsonb_array_elements_text(proposed))<>(select count(distinct x) from jsonb_array_elements_text(proposed) x)
  or length(note)>1000 or (note<>'' and not coalesce((p->>'notesEnabled')::boolean,false))
 then raise exception 'INVALID_ROLE_EVALUATION';end if;
 return new;
end;
$$;
revoke all on function gradesync_internal.guard_role_evaluation() from public,anon,authenticated;
create trigger gs_guard_role_evaluation before insert or update on public.scores
 for each row execute function gradesync_internal.guard_role_evaluation();

create or replace function gradesync_internal.guard_official_roles()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare p jsonb; threshold numeric; cast_id uuid; cast_status text;
begin
 select g.extra_data->'gsCasting',g.pass_score,g.casting_id,c.status
 into p,threshold,cast_id,cast_status
 from public.candidates a join public.competition_groups g on g.id=a.group_id
 join public.gs_castings c on c.id=g.casting_id where a.id=new.candidate_id;
 if cast_id is distinct from new.casting_id then raise exception 'CASTING_CANDIDATE_MISMATCH'; end if;
 if cardinality(new.assigned_roles)>40 or array_position(new.assigned_roles,null) is not null
  or (select count(*) from unnest(new.assigned_roles))<>(select count(distinct x) from unnest(new.assigned_roles) x)
  or not (coalesce(p->'roles','[]'::jsonb) @> to_jsonb(new.assigned_roles))
 then raise exception 'INVALID_OFFICIAL_ROLES';end if;
 if jsonb_array_length(coalesce(p->'roles','[]'::jsonb))>0 and new.review_status='approved' then
  if new.score is null or new.outcome is distinct from
   (case when cardinality(new.assigned_roles)>0 and new.score>=threshold then 'passed' else 'failed' end)
  then raise exception 'ROLE_OUTCOME_MISMATCH';end if;
 end if;
 if tg_op='UPDATE' then
  if (old.synced_at is not null or cast_status in ('published','archived')) and
   (new.assigned_roles is distinct from old.assigned_roles or new.outcome is distinct from old.outcome or new.review_status is distinct from old.review_status)
  then raise exception 'ROLE_DECISION_LOCKED';end if;
 end if;
 return new;
end;
$$;
revoke all on function gradesync_internal.guard_official_roles() from public,anon,authenticated;
create trigger gs_guard_official_roles before insert or update on public.gs_casting_decisions
 for each row execute function gradesync_internal.guard_official_roles();

CREATE OR REPLACE FUNCTION public.gs_save_casting_evaluation(p_candidate_id uuid, p_group_id uuid, p_scores jsonb, p_total_score numeric, p_expected_revision integer, p_roles text[], p_note text)
 RETURNS scores
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'auth'
AS $function$
declare
 v_grader uuid;
 v_profile public.profiles%rowtype;
 v_result public.scores%rowtype;
 v_total numeric:=0;
 v_weight numeric:=0;
 v_allowed boolean;
 crit jsonb;
 k text;
begin
 v_grader:=coalesce(public.gs_current_grader_id(),(select auth.uid()));
 select * into v_profile from public.profiles where id=v_grader and role='Grader' and status='Active';
 if not found then raise exception 'GRADER_NOT_AUTHORIZED';end if;
 if not public.is_grader_assigned(p_group_id) then raise exception 'GRADER_GROUP_NOT_ASSIGNED';end if;
 if not exists(select 1 from public.candidates where id=p_candidate_id and group_id=p_group_id)
 then raise exception 'CANDIDATE_GROUP_MISMATCH';end if;
 if p_expected_revision is null or p_expected_revision < 0 then raise exception 'INVALID_SCORE_REVISION';end if;
 if p_scores is null or jsonb_typeof(p_scores)<>'object' then raise exception 'INVALID_SCORE_PAYLOAD';end if;
 if exists(
  select 1 from jsonb_each(p_scores) item
  where jsonb_typeof(item.value)<>'number'
    or (item.value #>> '{}')::numeric < 0
    or (item.value #>> '{}')::numeric > 10
 ) then raise exception 'INVALID_SCORE_VALUE';end if;
 if not public.gs_scoring_allowed(v_grader,p_group_id,p_scores)
 then raise exception 'UNASSIGNED_SCORING_CRITERION';end if;
 if exists(select 1 from public.grader_verifications where grader_id=v_grader
 and group_id=p_group_id and is_verified=true) or
 public.gs_has_receipt(v_grader,p_group_id)
 then raise exception 'SCORES_ALREADY_SUBMITTED';end if;
 -- Normalized average of only the criteria assigned to this judge.
 for crit in select value from public.competition_groups g,
 lateral jsonb_array_elements(g.criteria) where g.id=p_group_id
 loop
  k:=crit->>'name';
  v_allowed:=not exists(select 1 from public.gs_criterion_grants x where x.grader_id=v_grader and x.group_id=p_group_id)
   or exists(select 1 from public.gs_criterion_grants x where x.grader_id=v_grader and x.group_id=p_group_id and x.criterion=k);
  if v_allowed then
   v_weight:=v_weight+coalesce((crit->>'weight')::numeric,0);
   if p_scores?k then v_total:=v_total+((p_scores->>k)::numeric)*coalesce((crit->>'weight')::numeric,0);end if;
  end if;
 end loop;
 if v_weight<=0 then raise exception 'MISSING_SCORING_WEIGHTS';end if;
 v_total:=round(v_total/v_weight,2);
 if p_roles is null or p_note is null then raise exception 'INVALID_ROLE_EVALUATION'; end if;
 if p_expected_revision=0 then
  insert into public.scores(candidate_id,group_id,grader_id,grader_code,grader_name,scores,total_score,revision,locked,updated_at,extra_data)
  values(p_candidate_id,p_group_id,v_grader,v_profile.code,v_profile.name,p_scores,v_total,1,false,now(),jsonb_build_object('gsProposedRoles',p_roles,'gsJudgeNote',p_note))
  on conflict (candidate_id,grader_id) do nothing returning * into v_result;
 else
  update public.scores set scores=p_scores,total_score=v_total,revision=revision+1,updated_at=now(),
   grader_code=v_profile.code,grader_name=v_profile.name,
   extra_data=coalesce(extra_data,'{}'::jsonb)||jsonb_build_object('gsProposedRoles',p_roles,'gsJudgeNote',p_note)
  where candidate_id=p_candidate_id and group_id=p_group_id and grader_id=v_grader and
   revision=p_expected_revision and locked=false returning * into v_result;
 end if;
 if not found then raise exception 'SCORE_CONFLICT';end if;
 return v_result;
end
$function$
;
revoke all on function public.gs_save_casting_evaluation(uuid,uuid,jsonb,numeric,integer,text[],text) from public,anon;
grant execute on function public.gs_save_casting_evaluation(uuid,uuid,jsonb,numeric,integer,text[],text) to authenticated;

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

 -- Serialize the snapshot with concurrent score writes (which take a group share lock).
 perform 1 from public.competition_groups where id=p_group for update;
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
$function$
;
revoke all on function public.gs_finalize_grading_otp(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.gs_finalize_grading_otp(uuid,uuid,text) to service_role;
notify pgrst, 'reload schema';
