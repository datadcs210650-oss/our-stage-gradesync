-- Enforce score integrity at the DB boundary for all authenticated BGK,
-- even if a client bypasses the preferred revision-checked RPC.
create or replace function public.gs_guard_score_write()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,auth
as $$
declare v_actor uuid;v_profile public.profiles%rowtype;v_total numeric:=0;v_weight numeric:=0;
begin
 if coalesce((select auth.role()),'') <> 'authenticated' then return new;end if;
 v_actor:=coalesce(public.gs_current_grader_id(),(select auth.uid()));
 select * into v_profile from public.profiles
  where id=v_actor and role='Grader' and status='Active';
 if not found or new.grader_id<>v_actor or not public.is_grader_assigned(new.group_id)
 then raise exception 'GRADER_SCORE_FORBIDDEN';end if;
 if tg_op='UPDATE' then
  if old.locked then raise exception 'SCORE_LOCKED';end if;
  if old.grader_id<>new.grader_id or old.candidate_id<>new.candidate_id
    or old.group_id<>new.group_id then raise exception 'SCORE_IDENTITY_IMMUTABLE';end if;
 end if;
 if new.locked is true or new.submitted_at is not null then raise exception 'OTP_REQUIRED_FOR_SUBMISSION';end if;
 if exists(select 1 from public.gs_grading_receipts
   where grader_id=v_actor and group_id=new.group_id) then raise exception 'ALREADY_CONFIRMED';end if;
 if not exists(select 1 from public.candidates
   where id=new.candidate_id and group_id=new.group_id) then raise exception 'CANDIDATE_GROUP_MISMATCH';end if;
 if jsonb_typeof(new.scores)<>'object' or exists(
  select 1 from jsonb_each(new.scores) kv
  where jsonb_typeof(kv.value)<>'number'
     or (kv.value #>> '{}')::numeric<0
     or (kv.value #>> '{}')::numeric>10
 ) then raise exception 'INVALID_SCORE_VALUE';end if;
 if not public.gs_scoring_allowed(v_actor,new.group_id,new.scores)
 then raise exception 'UNASSIGNED_CRITERION';end if;
 select coalesce(sum(coalesce((new.scores->>(crit->>'name'))::numeric,0)
   * coalesce((crit->>'weight')::numeric,0)),0),
   coalesce(sum(coalesce((crit->>'weight')::numeric,0)),0)
 into v_total,v_weight
 from public.competition_groups g
 cross join lateral jsonb_array_elements(g.criteria) crit
 where g.id=new.group_id and (
   not exists(select 1 from public.gs_criterion_grants grant_row
      where grant_row.grader_id=v_actor and grant_row.group_id=new.group_id)
   or exists(select 1 from public.gs_criterion_grants grant_row
      where grant_row.grader_id=v_actor and grant_row.group_id=new.group_id
        and grant_row.criterion=crit->>'name')
 );
 if v_weight<=0 then raise exception 'MISSING_SCORING_WEIGHTS';end if;
 new.total_score:=round(v_total/v_weight,2);
 new.grader_code:=v_profile.code;
 new.grader_name:=v_profile.name;
 new.locked:=false;
 new.submitted_at:=null;
 new.updated_at:=now();
 if tg_op='INSERT' then new.revision:=1;
 else new.revision:=old.revision+1;end if;
 return new;
end
$$;
revoke all on function public.gs_guard_score_write() from public,anon,authenticated;
