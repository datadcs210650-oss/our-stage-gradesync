-- Atomic, revision-checked grading writes for the BGK Supabase-authenticated portal.
-- Only the owning active grader can save scores for an assigned group's candidate.
-- Existing grades and submission records are preserved.
create or replace function public.gradesync_save_score(
  p_candidate_id uuid,
  p_group_id uuid,
  p_scores jsonb,
  p_total_score numeric,
  p_expected_revision integer
) returns public.scores
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_profile public.profiles%rowtype;
  v_result public.scores%rowtype;
begin
  select * into v_profile
  from public.profiles
  where id = (select auth.uid()) and role = 'Grader' and status = 'Active';
  if not found then raise exception 'GRADER_NOT_AUTHORIZED'; end if;
  if not exists (
    select 1 from public.grader_assignments
    where grader_id = v_profile.id and group_id = p_group_id
  ) then raise exception 'GRADER_GROUP_NOT_ASSIGNED'; end if;
  if not exists (
    select 1 from public.candidates
    where id = p_candidate_id and group_id = p_group_id
  ) then raise exception 'CANDIDATE_GROUP_MISMATCH'; end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'INVALID_SCORE_REVISION';
  end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'object' or
     p_total_score is null or p_total_score < 0 or p_total_score > 10000 then
    raise exception 'INVALID_SCORE_PAYLOAD';
  end if;
  if exists (
    select 1 from jsonb_each(p_scores) as item
    where jsonb_typeof(item.value) <> 'number'
       or (item.value #>> '{}')::numeric < 0
       or (item.value #>> '{}')::numeric > 100
  ) then raise exception 'INVALID_SCORE_VALUE'; end if;
  if exists (
    select 1 from public.grader_verifications
    where group_id = p_group_id and grader_id = v_profile.id and is_verified = true
  ) then raise exception 'SCORES_ALREADY_SUBMITTED'; end if;

  if p_expected_revision = 0 then
    insert into public.scores
      (candidate_id,group_id,grader_id,grader_code,grader_name,
       scores,total_score,revision,locked,updated_at)
    values
      (p_candidate_id,p_group_id,v_profile.id,v_profile.code,v_profile.name,
       p_scores,p_total_score,1,false,now())
    on conflict (candidate_id,grader_id) do nothing
    returning * into v_result;
  else
    update public.scores
       set scores=p_scores,total_score=p_total_score,
           revision=revision+1,updated_at=now(),
           grader_code=v_profile.code,grader_name=v_profile.name
     where candidate_id=p_candidate_id and group_id=p_group_id
       and grader_id=v_profile.id and revision=p_expected_revision
       and locked=false
     returning * into v_result;
  end if;
  if not found then raise exception 'SCORE_CONFLICT'; end if;
  return v_result;
end;
$$;
revoke all on function public.gradesync_save_score(uuid,uuid,jsonb,numeric,integer) from public, anon;
grant execute on function public.gradesync_save_score(uuid,uuid,jsonb,numeric,integer) to authenticated;
