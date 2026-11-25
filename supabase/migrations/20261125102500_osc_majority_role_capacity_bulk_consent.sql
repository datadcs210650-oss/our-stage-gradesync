-- Majority and role capacity are enforced at the database, not just in the browser.
create or replace function public.osc_candidate_quorum(p_casting uuid)
returns table(candidate_id uuid, group_id uuid, expected_count integer, submitted_count integer, valid_ids uuid[], covered boolean)
language sql stable security invoker set search_path='' as $$
 with grp as (select g.id,g.criteria from public.competition_groups g where g.casting_id=p_casting),
 roster as (select a.group_id,a.grader_id from public.grader_assignments a join grp g on g.id=a.group_id),
 verified as (select distinct r.group_id,r.grader_id from roster r join public.grader_verifications v on v.group_id=r.group_id and v.grader_id=r.grader_id and v.is_verified join public.profiles p on p.id=r.grader_id and p.status='Active' and p.role='Grader'),
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
 from public.candidates c join grp g on g.id=c.group_id
$$;
revoke all on function public.osc_candidate_quorum(uuid) from public,anon,authenticated;
grant execute on function public.osc_candidate_quorum(uuid) to service_role;

create or replace function gradesync_internal.assert_candidate_majority(p_casting uuid,p_candidate uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare q record;
begin
 select * into q from public.osc_candidate_quorum(p_casting) x where x.candidate_id=p_candidate;
 if not found or q.expected_count=0 or q.submitted_count<=q.expected_count/2 or cardinality(q.valid_ids)<=q.expected_count/2 or not q.covered then
  raise exception 'GS_MAJORITY_REQUIRED';
 end if;
end
$$;
revoke all on function gradesync_internal.assert_candidate_majority(uuid,uuid) from public,anon,authenticated;

create or replace function gradesync_internal.guard_approval_capacity()
returns trigger language plpgsql security definer set search_path='' as $$
declare g public.competition_groups%rowtype; lim jsonb; role_name text; cap integer; used integer; max_roles integer;
begin
 if new.review_status<>'approved' then return new; end if;
 if tg_op='UPDATE' and new.review_status=old.review_status and new.assigned_roles=old.assigned_roles and new.score is not distinct from old.score and new.outcome=old.outcome and new.reviewed_at is not distinct from old.reviewed_at then return new;end if;
 select x.* into g from public.competition_groups x join public.candidates c on c.group_id=x.id where c.id=new.candidate_id for update of x;
 if not found or g.casting_id is distinct from new.casting_id then raise exception 'CASTING_CANDIDATE_MISMATCH';end if;
 perform gradesync_internal.assert_candidate_majority(new.casting_id,new.candidate_id);
 lim:=coalesce(g.extra_data->'gsRoleLimits','{}'::jsonb);
 max_roles:=coalesce((lim->>'maxOfficialRoles')::integer,1);
 if cardinality(new.assigned_roles)>max_roles then raise exception 'GS_OFFICIAL_ROLE_LIMIT';end if;
 if cardinality(new.assigned_roles)>0 and new.outcome<>'passed' then raise exception 'GS_ROLE_REQUIRES_PASS';end if;
 foreach role_name in array new.assigned_roles loop
  cap:=coalesce((lim->'capacity'->>role_name)::integer,1);
  select count(*) into used from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=g.id and d.candidate_id<>new.candidate_id and d.review_status='approved' and d.outcome='passed' and role_name=any(d.assigned_roles);
  if used>=cap then raise exception 'GS_ROLE_CAPACITY';end if;
 end loop;
 return new;
end
$$;
revoke all on function gradesync_internal.guard_approval_capacity() from public,anon,authenticated;
create trigger gs_approval_capacity before insert or update on public.gs_casting_decisions for each row execute function gradesync_internal.guard_approval_capacity();

create or replace function gradesync_internal.guard_role_limits()
returns trigger language plpgsql security definer set search_path='' as $$
declare p jsonb; lim jsonb; k text; v jsonb; roles jsonb; cap integer; used integer; max_roles integer;
begin
 p:=new.extra_data->'gsCasting';lim:=new.extra_data->'gsRoleLimits';
 if lim is null then return new;end if;
 if tg_op='UPDATE' and lim is not distinct from old.extra_data->'gsRoleLimits' and p is not distinct from old.extra_data->'gsCasting' then return new;end if;
 roles:=coalesce(p->'roles','[]'::jsonb);
 if jsonb_typeof(lim->'capacity') is distinct from 'object' or coalesce(lim->>'maxOfficialRoles','') !~ '^[0-9]{1,2}$' then raise exception 'GS_ROLE_LIMIT_INVALID';end if;
 max_roles:=(lim->>'maxOfficialRoles')::integer;
 if max_roles<1 or max_roles>greatest(1,jsonb_array_length(roles)) then raise exception 'GS_ROLE_LIMIT_INVALID';end if;
 for k,v in select key,value from jsonb_each(lim->'capacity') loop
  if not (roles ? k) or jsonb_typeof(v)<>'number' or (v#>>'{}') !~ '^[0-9]{1,4}$' then raise exception 'GS_ROLE_LIMIT_INVALID';end if;
  cap:=(v#>>'{}')::integer;
  if cap<1 or cap>1000 then raise exception 'GS_ROLE_LIMIT_INVALID';end if;
 end loop;
 for k in select jsonb_array_elements_text(roles) loop
  cap:=coalesce((lim->'capacity'->>k)::integer,1);
  select count(*) into used from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=new.id and d.review_status='approved' and d.outcome='passed' and k=any(d.assigned_roles);
  if used>cap then raise exception 'GS_ROLE_CAPACITY';end if;
 end loop;
 if exists(select 1 from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=new.id and d.review_status='approved' and cardinality(d.assigned_roles)>max_roles) then raise exception 'GS_OFFICIAL_ROLE_LIMIT';end if;
 return new;
end
$$;
revoke all on function gradesync_internal.guard_role_limits() from public,anon,authenticated;
create trigger gs_guard_role_limits before insert or update on public.competition_groups for each row execute function gradesync_internal.guard_role_limits();

-- Do not shrink the denominator once grading has begun. Cascades of authorized session deletion remain possible.
create or replace function gradesync_internal.guard_quorum_roster()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.competition_groups where id=old.group_id) or current_setting('osc.delete_session_scope',true)=old.group_id::text then return old;end if;
 perform 1 from public.competition_groups where id=old.group_id for update;
 if exists(select 1 from public.scores where group_id=old.group_id) or exists(select 1 from public.grader_verifications where group_id=old.group_id and is_verified) then raise exception 'GS_QUORUM_ROSTER_LOCKED';end if;
 return old;
end
$$;
revoke all on function gradesync_internal.guard_quorum_roster() from public,anon,authenticated;
create trigger gs_guard_quorum_roster before delete on public.grader_assignments for each row execute function gradesync_internal.guard_quorum_roster();

create or replace function public.osc_bulk_email_consent(p_group uuid,p_ids uuid[],p_consent boolean,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare cid uuid; n integer; st text;
begin
 if p_consent is null or cardinality(p_ids) not between 1 and 100 or coalesce(p_actor,'')='' then raise exception 'GS_CONSENT_INVALID';end if;
 select casting_id into cid from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND';end if;
 select status into st from public.gs_castings where id=cid for share;
 if p_consent and st in ('published','archived') then raise exception 'GS_CONSENT_FINAL';end if;
 update public.gs_candidate_identity i set email_consent=p_consent,updated_at=now()
 from public.candidates c where i.candidate_id=c.id and c.group_id=p_group and c.id=any(p_ids) and i.email_consent is distinct from p_consent and (not p_consent or coalesce(i.email,'') ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$');
 get diagnostics n=row_count;
 insert into public.audit_logs(group_id,action,details) values(p_group,'osc-bulk-email-consent',jsonb_build_object('actorUid',p_actor,'consent',p_consent,'requested',cardinality(p_ids),'changed',n));
 return jsonb_build_object('ok',true,'updated',n);
end
$$;
revoke all on function public.osc_bulk_email_consent(uuid,uuid[],boolean,text) from public,anon,authenticated;
grant execute on function public.osc_bulk_email_consent(uuid,uuid[],boolean,text) to service_role;
notify pgrst,'reload schema';