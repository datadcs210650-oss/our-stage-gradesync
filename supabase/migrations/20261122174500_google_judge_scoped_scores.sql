-- Google graders use the invited, verified identity mapped to their existing profile.
-- Writes are server-authoritative, revision checked, and criterion-scoped.
create or replace function public.is_grader_assigned(target_group_id uuid)
returns boolean language sql stable security definer set search_path = pg_catalog,public,auth
as $$
 select exists(
  select 1 from public.grader_assignments a join public.profiles p on p.id=a.grader_id
  where a.grader_id=coalesce(public.gs_current_grader_id(),(select auth.uid()))
    and a.group_id=target_group_id and p.role='Grader' and p.status='Active'
 )
$$;
create or replace function public.gs_scoring_allowed(grader uuid,groupid uuid,detail jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog,public,auth
as $$
 select not exists(
  select 1 from jsonb_object_keys(coalesce(detail,'{}'::jsonb)) key
  where not exists(
   select 1 from public.competition_groups g,cross join lateral jsonb_array_elements(g.criteria) criterion
   where g.id=groupid and criterion->>'name'=key
  )
  or (
   exists(select 1 from public.gs_criterion_grants x where x.grader_id=grader and x.group_id=groupid)
   and not exists(select 1 from public.gs_criterion_grants x where x.grader_id=grader and x.group_id=groupid and x.criterion=key)
  )
 )
$$;
revoke all on function public.gs_scoring_allowed(uuid,uuid,jsonb) from public,anon;
grant execute on function public.gs_scoring_allowed(uuid,uuid,jsonb) to authenticated;
create or replace function public.gs_guard_score_write()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,auth
as $$
declare v_actor uuid;
begin
 if coalesce((select auth.role()),'') <> 'authenticated' then return new; end if;
 v_actor:=coalesce(public.gs_current_grader_id(),(select auth.uid()));
 if v_actor is null or new.grader_id<>v_actor or
 not public.is_grader_assigned(new.group_id) then raise exception 'GRADER_SCORE_FORBIDDEN';end if;
 if tg_op='UPDATE' and old.locked then raise exception 'SCORE_LOCKED';end if;
 if exists(select 1 from public.gs_grading_receipts
            where grader_id=v_actor and group_id=new.group_id) then raise exception 'GRADING_ALREADY_CONFIRMED';end if;
 if not public.gs_scoring_allowed(v_actor,new.group_id,new.scores) then
  raise exception 'UNASSIGNED_SCORING_CRITERION';end if;
 return new;
end
$$;
drop trigger if exists gs_score_authorize on public.scores;
create trigger gs_score_authorize before insert or update on public.scores
for each row execute function public.gs_guard_score_write();
create or replace function public.gs_guard_otp_verification()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public,auth
as $$
begin
 if (select auth.role())='authenticated' and
   public.gs_current_grader_id() is not null and new.is_verified=true then
   raise exception 'OTP_VERIFICATION_REQUIRED';
 end if;
 return new;
end
$$;
drop trigger if exists gs_verify_otp_gate on public.grader_verifications;
create trigger gs_verify_otp_gate before insert or update on public.grader_verifications
for each row execute function public.gs_guard_otp_verification();

create or replace function public.gradesync_save_score(
  p_candidate_id uuid, p_group_id uuid, p_scores jsonb,
  p_total_score numeric, p_expected_revision integer
) returns public.scores language plpgsql security invoker set search_path = pg_catalog,public,auth
as $$
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
    or (item.value #>> '{}')::numeric > 100
 ) then raise exception 'INVALID_SCORE_VALUE';end if;
 if not public.gs_scoring_allowed(v_grader,p_group_id,p_scores)
 then raise exception 'UNASSIGNED_SCORING_CRITERION';end if;
 if exists(select 1 from public.grader_verifications where grader_id=v_grader
 and group_id=p_group_id and is_verified=true) or
 exists(select 1 from public.gs_grading_receipts where grader_id=v_grader and group_id=p_group_id)
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
 if p_expected_revision=0 then
  insert into public.scores(candidate_id,group_id,grader_id,grader_code,grader_name,scores,total_score,revision,locked,updated_at)
  values(p_candidate_id,p_group_id,v_grader,v_profile.code,v_profile.name,p_scores,v_total,1,false,now())
  on conflict (candidate_id,grader_id) do nothing returning * into v_result;
 else
  update public.scores set scores=p_scores,total_score=v_total,revision=revision+1,updated_at=now(),
   grader_code=v_profile.code,grader_name=v_profile.name
  where candidate_id=p_candidate_id and group_id=p_group_id and grader_id=v_grader and
   revision=p_expected_revision and locked=false returning * into v_result;
 end if;
 if not found then raise exception 'SCORE_CONFLICT';end if;
 return v_result;
end
$$;
revoke all on function public.gradesync_save_score(uuid,uuid,jsonb,numeric,integer) from public,anon;
grant execute on function public.gradesync_save_score(uuid,uuid,jsonb,numeric,integer) to authenticated;
