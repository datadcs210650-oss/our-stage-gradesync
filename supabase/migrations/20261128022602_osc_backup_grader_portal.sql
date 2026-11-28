
-- Private-by-grant fallback. No change to existing RLS or Google identity resolution.
create table public.osc_backup_access (
 grader_id uuid primary key references public.profiles(id) on delete cascade,
 secret_hash text not null check(secret_hash ~ '^[a-f0-9]{64}$'),
 enabled boolean not null default false, expires_at timestamptz not null,
 generation uuid not null default gen_random_uuid(), failed integer not null default 0,
 window_at timestamptz not null default now(), issued_at timestamptz not null default now(),
 issued_by text not null, request_id uuid
);
create table public.osc_backup_sessions(
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 grader_id uuid not null references public.osc_backup_access(grader_id) on delete cascade,
 generation uuid not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
create index osc_backup_sessions_grader on public.osc_backup_sessions(grader_id,expires_at);
create table public.osc_backup_ip_buckets(bucket integer primary key check(bucket between 0 and 4095), window_at timestamptz not null, attempts integer not null);
create table public.osc_backup_login_events(id uuid primary key default gen_random_uuid(),grader_id uuid not null references public.profiles(id) on delete cascade,action text not null,created_at timestamptz not null default now(),admin_uid text);
create index osc_backup_events_grader on public.osc_backup_login_events(grader_id,created_at desc);
alter table public.osc_backup_access enable row level security;
alter table public.osc_backup_sessions enable row level security;
alter table public.osc_backup_ip_buckets enable row level security;
alter table public.osc_backup_login_events enable row level security;
revoke all on public.osc_backup_access,public.osc_backup_sessions,public.osc_backup_ip_buckets,public.osc_backup_login_events from public,anon,authenticated;
grant select,insert,update,delete on public.osc_backup_access,public.osc_backup_sessions,public.osc_backup_ip_buckets,public.osc_backup_login_events to service_role;
create function gradesync_internal.backup_actor(p_token text) returns uuid language plpgsql set search_path='' as $$
declare v_id uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'BACKUP_UNAUTHORIZED';end if;
 select a.grader_id into v_id from public.osc_backup_access a join public.osc_backup_sessions s on s.grader_id=a.grader_id and s.generation=a.generation
 join public.profiles p on p.id=a.grader_id
 where s.token_hash=p_token and a.enabled and a.expires_at>clock_timestamp() and s.expires_at>clock_timestamp()
 and p.role='Grader' and p.status='Active' and not (p.extra_data ? 'oscArchivedAt')
 for share of a,s;
 if v_id is null then raise exception 'BACKUP_UNAUTHORIZED';end if;
 return v_id;
end $$;
revoke all on function gradesync_internal.backup_actor(text) from public,anon,authenticated;
grant execute on function gradesync_internal.backup_actor(text) to service_role;
create function public.osc_backup_admin(p_grader uuid,p_action text,p_hash text,p_expires timestamptz,p_actor text,p_request uuid) returns jsonb language plpgsql set search_path='' as $$
declare g public.profiles%rowtype;a public.osc_backup_access%rowtype;history jsonb;contact text;v_issued uuid;
begin
 select * into g from public.profiles where id=p_grader and role='Grader' for share;
 if not found then raise exception 'BACKUP_NOT_FOUND';end if;
 select email into contact from public.gs_google_grader_access where profile_id=g.id;
 if p_action='issue' then
  if g.status<>'Active' or g.extra_data ? 'oscArchivedAt' or contact is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_expires is null or p_expires<=now() or p_expires>now()+interval '30 days' or p_request is null then raise exception 'BACKUP_INVALID';end if;
  insert into public.osc_backup_access(grader_id,secret_hash,enabled,expires_at,issued_by,request_id) values(g.id,p_hash,true,p_expires,p_actor,p_request)
   on conflict(grader_id) do update set secret_hash=excluded.secret_hash,enabled=true,expires_at=excluded.expires_at,generation=gen_random_uuid(),failed=0,window_at=now(),issued_at=now(),issued_by=p_actor,request_id=excluded.request_id
   where osc_backup_access.request_id is distinct from excluded.request_id returning grader_id into v_issued;
  if v_issued is not null then delete from public.osc_backup_sessions where grader_id=g.id;
   insert into public.osc_backup_login_events(grader_id,action,admin_uid) values(g.id,'issued',p_actor);end if;
 elsif p_action='revoke' then
  update public.osc_backup_access set enabled=false,generation=gen_random_uuid() where grader_id=g.id;
  delete from public.osc_backup_sessions where grader_id=g.id;
  insert into public.osc_backup_login_events(grader_id,action,admin_uid) values(g.id,'revoked',p_actor);
 elsif p_action<>'status' then raise exception 'BACKUP_INVALID';end if;
 select * into a from public.osc_backup_access where grader_id=g.id;
 select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) into history from (select action,created_at,admin_uid from public.osc_backup_login_events where grader_id=g.id order by created_at desc limit 30) x;
 return jsonb_build_object('ok',true,'enabled',coalesce(a.enabled and a.expires_at>now() and g.status='Active',false),'expiresAt',a.expires_at,'code',g.code,'name',g.name,'email',contact,'history',history,'issued',v_issued is not null);
end $$;
revoke all on function public.osc_backup_admin(uuid,text,text,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.osc_backup_admin(uuid,text,text,timestamptz,text,uuid) to service_role;
create function public.osc_backup_login(p_code text,p_hash text,p_token text,p_bucket integer) returns jsonb language plpgsql set search_path='' as $$
declare g public.profiles%rowtype;a public.osc_backup_access%rowtype;v_count integer;v_now timestamptz:=clock_timestamp();v_exp timestamptz;
begin
 if p_code is null or p_code !~ '^[A-Z][A-Z0-9_-]{2,19}$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_token is null or p_token !~ '^[a-f0-9]{64}$' or p_bucket is null or p_bucket not between 0 and 4095 then return jsonb_build_object('ok',false);end if;
 insert into public.osc_backup_ip_buckets(bucket,window_at,attempts) values(p_bucket,v_now,1)
 on conflict(bucket) do update set attempts=case when osc_backup_ip_buckets.window_at<v_now-interval '15 minutes' then 1 else least(osc_backup_ip_buckets.attempts+1,1000) end,window_at=case when osc_backup_ip_buckets.window_at<v_now-interval '15 minutes' then v_now else osc_backup_ip_buckets.window_at end returning attempts into v_count;
 if v_count>30 then return jsonb_build_object('ok',false,'limited',true);end if;
 select * into g from public.profiles where code=p_code and role='Grader' and status='Active' and not(extra_data ? 'oscArchivedAt');
 if not found then return jsonb_build_object('ok',false);end if;
 select * into a from public.osc_backup_access where grader_id=g.id for update;
 if not found or not a.enabled or a.expires_at<=v_now then return jsonb_build_object('ok',false);end if;
 if a.window_at<v_now-interval '15 minutes' then a.failed:=0;a.window_at:=v_now;end if;
 if a.failed>=5 then return jsonb_build_object('ok',false,'limited',true);end if;
 if a.secret_hash<>p_hash then
  update public.osc_backup_access set failed=a.failed+1,window_at=a.window_at where grader_id=g.id;
  insert into public.osc_backup_login_events(grader_id,action) values(g.id,'login-failed');
  return jsonb_build_object('ok',false);
 end if;
 update public.osc_backup_access set failed=0,window_at=v_now where grader_id=g.id;
 v_exp:=least(a.expires_at,v_now+interval '8 hours');
 delete from public.osc_backup_sessions where grader_id=g.id and (expires_at<=v_now or generation<>a.generation);
 delete from public.osc_backup_sessions where token_hash in (select token_hash from public.osc_backup_sessions where grader_id=g.id order by created_at desc offset 7);
 insert into public.osc_backup_sessions(token_hash,grader_id,generation,expires_at) values(p_token,g.id,a.generation,v_exp);
 insert into public.osc_backup_login_events(grader_id,action) values(g.id,'login-success');
 return jsonb_build_object('ok',true,'name',g.name,'code',g.code,'expiresAt',v_exp);
end $$;
revoke all on function public.osc_backup_login(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.osc_backup_login(text,text,text,integer) to service_role;
create function public.osc_backup_logout(p_token text) returns void language sql set search_path='' as $$ delete from public.osc_backup_sessions where token_hash=p_token $$;
revoke all on function public.osc_backup_logout(text) from public,anon,authenticated;
grant execute on function public.osc_backup_logout(text) to service_role;
create function gradesync_internal.backup_group(p_grader uuid,p_group uuid,p_write boolean) returns public.competition_groups language plpgsql set search_path='' as $$
declare g public.competition_groups%rowtype;c public.gs_castings%rowtype;
begin
 select * into g from public.competition_groups where id=p_group and osc_deleted_at is null for share;
 if not found or not exists(select 1 from public.grader_assignments where group_id=p_group and grader_id=p_grader for share) then raise exception 'BACKUP_FORBIDDEN';end if;
 if g.casting_id is not null then select * into c from public.gs_castings where id=g.casting_id for share;end if;
 if c.status in ('archived') or (c.status='published' and coalesce(c.publish_at,now())<=now()) or exists(select 1 from public.osc_group_publications where group_id=p_group and cancelled_at is null and scheduled_at<=now()) then raise exception 'BACKUP_FORBIDDEN';end if;
 if p_write and (coalesce(c.status in ('approved','published','archived'),false) or exists(select 1 from public.osc_group_publications where group_id=p_group and cancelled_at is null)
  or (g.close_at is not null and now()>=g.close_at)
  or not coalesce((g.open_mode='auto' and g.open_at<=now()) or (g.open_mode<>'auto' and g.is_open),false)
  or exists(select 1 from public.gs_grading_receipts where group_id=p_group and grader_id=p_grader)
  or exists(select 1 from public.grader_verifications where group_id=p_group and grader_id=p_grader and is_verified)) then raise exception 'BACKUP_CLOSED';end if;
 return g;
end $$;
revoke all on function gradesync_internal.backup_group(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function gradesync_internal.backup_group(uuid,uuid,boolean) to service_role;
create function public.osc_backup_view(p_token text,p_group uuid) returns jsonb language plpgsql set search_path='' as $$
declare v_id uuid;g public.competition_groups%rowtype;v_groups jsonb;v_criteria jsonb;v_rows jsonb;v_locked boolean;v_open boolean;
begin
 v_id:=gradesync_internal.backup_actor(p_token);
 if p_group is null then
  select coalesce(jsonb_agg(to_jsonb(x) order by x.name),'[]'::jsonb) into v_groups from (
   select gg.id,gg.name,case when r.grader_id is not null then 'submitted' else 'available' end as status
   from public.grader_assignments a join public.competition_groups gg on gg.id=a.group_id
   left join public.gs_castings c on c.id=gg.casting_id left join public.gs_grading_receipts r on r.group_id=gg.id and r.grader_id=v_id
   where a.grader_id=v_id and gg.osc_deleted_at is null and not coalesce(c.status='archived' or (c.status='published' and coalesce(c.publish_at,now())<=now()),false)
   and not exists(select 1 from public.osc_group_publications q where q.group_id=gg.id and q.cancelled_at is null and q.scheduled_at<=now()) order by gg.name limit 100) x;
  return jsonb_build_object('ok',true,'groups',v_groups);
 end if;
 g:=gradesync_internal.backup_group(v_id,p_group,false);
 if (select count(*) from public.candidates where group_id=p_group)>500 then raise exception 'BACKUP_LIMIT';end if;
 select coalesce(jsonb_agg(cr order by ord),'[]'::jsonb) into v_criteria from jsonb_array_elements(g.criteria) with ordinality t(cr,ord)
 where not exists(select 1 from public.gs_criterion_grants where group_id=p_group and grader_id=v_id) or exists(select 1 from public.gs_criterion_grants a where group_id=p_group and grader_id=v_id and a.criterion=cr->>'name');
 select exists(select 1 from public.gs_grading_receipts where group_id=p_group and grader_id=v_id) or exists(select 1 from public.grader_verifications where group_id=p_group and grader_id=v_id and is_verified) into v_locked;
 select exists(select 1 from public.osc_session_controls() sc where sc.group_id=p_group and sc.access_state='open') and not exists(select 1 from public.osc_group_publications q where q.group_id=p_group and q.cancelled_at is null) into v_open;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'code',c.code,'name',c.name,'present',gradesync_internal.attendance_eligible(c.id),'registeredRoles',coalesce(c.custom_fields->'gsRoleIds','[]'::jsonb),'scores',coalesce(s.scores,'{}'::jsonb),'revision',coalesce(s.revision,0),'proposedRoles',coalesce(s.extra_data->'gsProposedRoles','[]'::jsonb),'note',coalesce(s.extra_data->>'gsJudgeNote','')) order by c.code,c.id),'[]'::jsonb) into v_rows from public.candidates c left join public.scores s on s.candidate_id=c.id and s.group_id=p_group and s.grader_id=v_id where c.group_id=p_group;
 return jsonb_build_object('ok',true,'groupId',g.id,'name',g.name,'criteria',v_criteria,'rows',v_rows,'policy',g.extra_data->'gsCasting','locked',v_locked,'open',v_open);
end $$;
revoke all on function public.osc_backup_view(text,uuid) from public,anon,authenticated;
grant execute on function public.osc_backup_view(text,uuid) to service_role;
create function public.osc_backup_save(p_token text,p_group uuid,p_candidate uuid,p_scores jsonb,p_revision integer,p_roles jsonb,p_note text) returns jsonb language plpgsql set search_path='' as $$
declare v_id uuid;g public.competition_groups%rowtype;p public.profiles%rowtype;v_old public.scores%rowtype;v_result public.scores%rowtype;v_total numeric;v_weight numeric;v_extra jsonb;
begin
 v_id:=gradesync_internal.backup_actor(p_token);
 g:=gradesync_internal.backup_group(v_id,p_group,true);
 select * into p from public.profiles where id=v_id and status='Active' and role='Grader' for share;
 if not found then raise exception 'BACKUP_UNAUTHORIZED';end if;
 if not exists(select 1 from public.candidates where id=p_candidate and group_id=p_group for share) or not gradesync_internal.attendance_eligible(p_candidate) then raise exception 'BACKUP_FORBIDDEN';end if;
 if p_revision is null or p_revision<0 or p_scores is null or jsonb_typeof(p_scores)<>'object' or length(p_scores::text)>15000 or exists(select 1 from jsonb_each(p_scores) x where case when jsonb_typeof(x.value)='number' then (x.value #>> '{}')::numeric not between 0 and 10 else true end) or not public.gs_scoring_allowed(v_id,p_group,p_scores) then raise exception 'BACKUP_INVALID_SCORE';end if;
 if exists(select 1 from public.gs_casting_decisions where candidate_id=p_candidate and review_status<>'pending') then raise exception 'BACKUP_CLOSED';end if;
 select coalesce(sum(coalesce((p_scores->>(cr->>'name'))::numeric,0)*coalesce((cr->>'weight')::numeric,0)),0),coalesce(sum(coalesce((cr->>'weight')::numeric,0)),0) into v_total,v_weight from jsonb_array_elements(g.criteria) cr
 where not exists(select 1 from public.gs_criterion_grants where grader_id=v_id and group_id=p_group) or exists(select 1 from public.gs_criterion_grants a where a.grader_id=v_id and a.group_id=p_group and a.criterion=cr->>'name');
 if v_weight<=0 then raise exception 'BACKUP_INVALID_SCORE';end if;
 select * into v_old from public.scores where candidate_id=p_candidate and grader_id=v_id and group_id=p_group for update;
 if (v_old.id is not null and (v_old.revision<>p_revision or v_old.locked)) or (v_old.id is null and p_revision<>0) then raise exception 'SCORE_CONFLICT';end if;
 v_extra:=coalesce(v_old.extra_data,'{}'::jsonb);
 if p_roles is not null then if jsonb_typeof(p_roles)<>'array' or jsonb_array_length(p_roles)>40 then raise exception 'BACKUP_INVALID_SCORE';end if;v_extra:=v_extra||jsonb_build_object('gsProposedRoles',p_roles);end if;
 if p_note is not null then if length(p_note)>1000 then raise exception 'BACKUP_INVALID_SCORE';end if;v_extra:=v_extra||jsonb_build_object('gsJudgeNote',p_note);end if;
 if v_old.id is not null and v_old.scores=p_scores and v_old.extra_data=v_extra then return jsonb_build_object('ok',true,'revision',v_old.revision,'total',v_old.total_score);end if;
 if v_old.id is null then
  insert into public.scores(candidate_id,group_id,grader_id,grader_code,grader_name,scores,total_score,revision,locked,updated_at,extra_data) values(p_candidate,p_group,v_id,p.code,p.name,p_scores,round(v_total/v_weight,2),1,false,now(),v_extra) on conflict(candidate_id,grader_id) do nothing returning * into v_result;
 else update public.scores set scores=p_scores,total_score=round(v_total/v_weight,2),revision=revision+1,updated_at=now(),extra_data=v_extra where id=v_old.id and revision=p_revision and locked=false returning * into v_result;end if;
 if v_result.id is null then raise exception 'SCORE_CONFLICT';end if;
 return jsonb_build_object('ok',true,'revision',v_result.revision,'total',v_result.total_score);
end $$;
revoke all on function public.osc_backup_save(text,uuid,uuid,jsonb,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.osc_backup_save(text,uuid,uuid,jsonb,integer,jsonb,text) to service_role;
CREATE OR REPLACE FUNCTION public.osc_backup_submit(p_token text, p_group uuid, p_expected text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 p_grader uuid; v_version text; v_incomplete integer; v_group_name text;
 v_profile public.profiles%rowtype;
 v_snapshot jsonb;v_hash text;
 v_total integer;v_count integer;v_missing integer;
 v_completeness jsonb; v_code text; v_confirmed timestamptz; v_casting uuid; v_status text; v_email text;
begin
 p_grader:=gradesync_internal.backup_actor(p_token);
 select email into v_email from public.gs_google_grader_access where profile_id=p_grader;
 if v_email is null then return jsonb_build_object('ok',false,'code','ACCESS_REVOKED');end if;
 select casting_id,name into v_casting,v_group_name from public.competition_groups
 where id=p_group and osc_deleted_at is null for update;
 if not found then return jsonb_build_object('ok',false,'code','GROUP_NOT_FOUND');end if;
 if exists(select 1 from public.osc_group_publications where group_id=p_group and cancelled_at is null) then
  return jsonb_build_object('ok',false,'code','SESSION_FINAL');end if;
 select * into v_profile from public.profiles
  where id=p_grader and role='Grader' and status='Active' for share;
 if not found then return jsonb_build_object('ok',false,'code','GRADER_INACTIVE');end if;
 if not exists(select 1 from public.grader_assignments
   where grader_id=p_grader and group_id=p_group for share) then
  return jsonb_build_object('ok',false,'code','NOT_ASSIGNED');end if;
 if exists(select 1 from public.gs_grading_receipts
   where grader_id=p_grader and group_id=p_group) then
  return jsonb_build_object('ok',false,'code','ALREADY_CONFIRMED');end if;

 if v_casting is not null then
  select status into v_status from public.gs_castings where id=v_casting for share;
  if v_status in ('published','archived','approved') then return jsonb_build_object('ok',false,'code','SESSION_FINAL');end if;
 end if;
 select count(*) into v_total from public.candidates where group_id=p_group and gradesync_internal.attendance_eligible(id);
 if v_total=0 then return jsonb_build_object('ok',false,'code','NO_PRESENT_CANDIDATES');end if;
 select count(*) into v_count from public.scores s
   where s.group_id=p_group and s.grader_id=p_grader
   and gradesync_internal.attendance_eligible(s.candidate_id)
   and jsonb_typeof(s.scores)='object' and s.scores <> '{}'::jsonb;
 select count(*),count(distinct c.id) into v_missing,v_incomplete
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
   'incompleteCandidates',v_incomplete,'partial',v_count<v_total or v_missing>0
 );
 select coalesce(jsonb_agg(jsonb_build_object(
  'candidateId',s.candidate_id,'scores',s.scores,
  'total',s.total_score,'revision',s.revision) || case when s.extra_data ? 'gsProposedRoles' or s.extra_data ? 'gsJudgeNote' then jsonb_build_object('proposedRoles',coalesce(s.extra_data->'gsProposedRoles','[]'::jsonb),'note',coalesce(s.extra_data->>'gsJudgeNote','')) else '{}'::jsonb end order by s.candidate_id),'[]'::jsonb)
 into v_snapshot from public.scores s
 where s.group_id=p_group and s.grader_id=p_grader and gradesync_internal.attendance_eligible(s.candidate_id);
 v_hash:=encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex');
 select encode(sha256(convert_to(jsonb_build_array(v_hash,v_completeness,g.criteria,
  (select jsonb_agg(id order by id) from public.candidates where group_id=p_group and gradesync_internal.attendance_eligible(id)),
  (select jsonb_agg(criterion order by criterion) from public.gs_criterion_grants where group_id=p_group and grader_id=p_grader)
 )::text,'UTF8')),'hex') into v_version from public.competition_groups g where id=p_group;
 if p_expected is null then return jsonb_build_object('ok',true,'version',v_version,
 'graderName',v_profile.name,'groupName',v_group_name,'completeness',v_completeness);end if;
 if p_expected<>v_version then return jsonb_build_object('ok',false,'code','VERSION_CHANGED');end if;
 update public.scores set locked=true,submitted_at=now(),updated_at=now()
 where group_id=p_group and grader_id=p_grader and locked=false and gradesync_internal.attendance_eligible(candidate_id);
 insert into public.gs_grading_receipts(
   grader_id,group_id,email,grader_name,verified_at,snapshot,snapshot_sha256,completeness,confirmation_method
 ) values(p_grader,p_group,v_email,v_profile.name,now(),v_snapshot,v_hash,v_completeness || jsonb_build_object('authMethod','backup-session','version',v_version),'backup-session')
 returning comparison_code,verified_at into v_code,v_confirmed;
 insert into public.grader_verifications(
  group_id,grader_id,grader_code,grader_name,is_verified,signed_at,updated_at
 ) values(p_group,p_grader,v_profile.code,v_profile.name,true,now(),now())
 on conflict(group_id,grader_id) do update
  set is_verified=true,signed_at=now(),updated_at=now();
 return jsonb_build_object('ok',true,'sha256',v_hash,'confirmedAt',now(),
  'completeness',v_completeness,'comparisonCode',v_code);
end
$function$
;

revoke all on function public.osc_backup_submit(text,uuid,text) from public,anon,authenticated;
grant execute on function public.osc_backup_submit(text,uuid,text) to service_role;
CREATE OR REPLACE FUNCTION gradesync_internal.queue_receipt_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.comparison_code is not null and new.confirmation_method in ('email-otp','google-session','backup-session') then
 insert into public.osc_receipt_mail_jobs(group_id,grader_id,comparison_code,kind,email,grader_name,group_name,confirmed_at)
 select new.group_id,new.grader_id,new.comparison_code,'completion',new.email,new.grader_name,g.name,new.verified_at from public.competition_groups g where g.id=new.group_id on conflict do nothing;
 end if;
 return new;
end $function$
;
CREATE OR REPLACE FUNCTION gradesync_internal.attendance_counts(p_group uuid)
 RETURNS TABLE(assigned_count integer, submitted_count integer)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select count(*)::int,count(*) filter(where exists(select 1 from public.gs_grading_receipts r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.profiles p on p.id=r.grader_id and p.role='Grader' and p.status='Active' where r.group_id=a.group_id and r.grader_id=a.grader_id and r.confirmation_method in ('email-otp','google-session','backup-session') and r.comparison_code ~ '^[0-9]{8}$' and r.snapshot_sha256 ~ '^[a-f0-9]{64}$'))::int from public.grader_assignments a where a.group_id=p_group
$function$
;
CREATE OR REPLACE FUNCTION public.osc_candidate_quorum(p_casting uuid)
 RETURNS TABLE(candidate_id uuid, group_id uuid, expected_count integer, submitted_count integer, valid_ids uuid[], covered boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with grp as (select g.id,g.criteria from public.competition_groups g where g.casting_id=p_casting),
 roster as (select a.group_id,a.grader_id from public.grader_assignments a join grp g on g.id=a.group_id),
 verified as (select distinct r.group_id,r.grader_id from roster r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.gs_grading_receipts gr on gr.group_id=r.group_id and gr.grader_id=r.grader_id and gr.confirmation_method in ('email-otp','google-session','backup-session') and gr.comparison_code ~ '^[0-9]{8}$' and gr.snapshot_sha256 ~ '^[a-f0-9]{64}$' join public.profiles p on p.id=r.grader_id and p.status='Active' and p.role='Grader'),
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
$function$
;

-- Refuse future backup login after an account lock even if the account is later unlocked.
create function gradesync_internal.revoke_backup_on_lock() returns trigger language plpgsql security definer set search_path='' as $$
begin if new.status<>'Active' or new.extra_data ? 'oscArchivedAt' then update public.osc_backup_access set enabled=false,generation=gen_random_uuid() where grader_id=new.id and enabled;delete from public.osc_backup_sessions where grader_id=new.id;end if;return new;end $$;
revoke all on function gradesync_internal.revoke_backup_on_lock() from public,anon,authenticated;
create trigger osc_backup_revoke_profile after update of status,extra_data on public.profiles for each row execute function gradesync_internal.revoke_backup_on_lock();

create function public.osc_backup_save_batch(p_token text,p_group uuid,p_rows jsonb) returns jsonb language plpgsql set search_path='' as $$
declare r jsonb;result jsonb:='[]'::jsonb;v jsonb;
begin
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 20 or length(p_rows::text)>120000 then raise exception 'BACKUP_INVALID_SCORE';end if;
 if (select count(*) from jsonb_array_elements(p_rows))<>(select count(distinct x->>'candidateId') from jsonb_array_elements(p_rows) x) then raise exception 'BACKUP_INVALID_SCORE';end if;
 perform gradesync_internal.backup_actor(p_token);
 for r in select value from jsonb_array_elements(p_rows) order by value->>'candidateId' loop
  v:=public.osc_backup_save(p_token,p_group,(r->>'candidateId')::uuid,r->'scores',(r->>'revision')::integer,r->'roles',r->>'note');
  result:=result||jsonb_build_array(v||jsonb_build_object('candidateId',r->>'candidateId'));
 end loop;
 return jsonb_build_object('ok',true,'rows',result);
end $$;
revoke all on function public.osc_backup_save_batch(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.osc_backup_save_batch(text,uuid,jsonb) to service_role;
