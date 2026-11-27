CREATE OR REPLACE FUNCTION public.osc_submit_grading(p_auth_user uuid, p_group uuid, p_expected text)
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
 select profile_id,email into p_grader,v_email from public.gs_google_grader_access
 where auth_user_id=p_auth_user and enabled for share;
 if not found then return jsonb_build_object('ok',false,'code','ACCESS_REVOKED');end if;
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
 ) values(p_grader,p_group,v_email,v_profile.name,now(),v_snapshot,v_hash,v_completeness || jsonb_build_object('authUserId',p_auth_user,'version',v_version),'google-session')
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
revoke all on function public.osc_submit_grading(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.osc_submit_grading(uuid,uuid,text) to service_role;
CREATE OR REPLACE FUNCTION gradesync_internal.queue_receipt_email()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.comparison_code is not null and new.confirmation_method in ('email-otp','google-session') then
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
 select count(*)::int,count(*) filter(where exists(select 1 from public.gs_grading_receipts r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.profiles p on p.id=r.grader_id and p.role='Grader' and p.status='Active' where r.group_id=a.group_id and r.grader_id=a.grader_id and r.confirmation_method in ('email-otp','google-session') and r.comparison_code ~ '^[0-9]{8}$' and r.snapshot_sha256 ~ '^[a-f0-9]{64}$'))::int from public.grader_assignments a where a.group_id=p_group
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
 verified as (select distinct r.group_id,r.grader_id from roster r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.gs_grading_receipts gr on gr.group_id=r.group_id and gr.grader_id=r.grader_id and gr.confirmation_method in ('email-otp','google-session') and gr.comparison_code ~ '^[0-9]{8}$' and gr.snapshot_sha256 ~ '^[a-f0-9]{64}$' join public.profiles p on p.id=r.grader_id and p.status='Active' and p.role='Grader'),
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
