-- Keep legacy groups and incomplete profiles editable while contacts stay manager-only.
alter table public.gs_candidate_identity
 alter column casting_id drop not null,
 alter column mssv drop not null;

create or replace function gradesync_internal.guard_session_config()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 if (new.criteria is distinct from old.criteria) and (
   exists(select 1 from public.scores where group_id=old.id)
   or exists(select 1 from public.gs_grading_receipts where group_id=old.id)
   or exists(select 1 from public.grader_verifications where group_id=old.id and is_verified)
   or exists(select 1 from public.gs_criterion_grants where group_id=old.id)
 ) then
  raise exception 'GS_SESSION_SCORE_CONFIG_LOCKED';
 end if;
 if old.casting_id is not null and (
   new.criteria is distinct from old.criteria or new.pass_score is distinct from old.pass_score
   or new.name is distinct from old.name or new.open_mode is distinct from old.open_mode
   or new.open_at is distinct from old.open_at or new.close_at is distinct from old.close_at
   or new.extra_data->'extraFields' is distinct from old.extra_data->'extraFields'
   or new.extra_data->'attendanceEnabled' is distinct from old.extra_data->'attendanceEnabled'
 ) then
  if exists(select 1 from public.gs_castings where id=old.casting_id and status in ('published','archived'))
   or exists(select 1 from public.gs_casting_decisions where casting_id=old.casting_id)
  then raise exception 'GS_SESSION_REVIEWED'; end if;
 end if;
 return new;
end;
$$;
revoke all on function gradesync_internal.guard_session_config() from public, anon, authenticated;
create trigger gs_guard_session_config before update on public.competition_groups
 for each row execute function gradesync_internal.guard_session_config();

-- Hold a shared lock through score validation so the settings cannot change midway.
create or replace function gradesync_internal.lock_scoring_group()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 perform 1 from public.competition_groups where id=new.group_id for share;
 return new;
end;
$$;
revoke all on function gradesync_internal.lock_scoring_group() from public, anon, authenticated;
create trigger a_gs_lock_scoring_group before insert or update on public.scores
 for each row execute function gradesync_internal.lock_scoring_group();
create trigger a_gs_lock_criterion_group before insert or update on public.gs_criterion_grants
 for each row execute function gradesync_internal.lock_scoring_group();

create or replace function gradesync_internal.link_candidate_identities()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
 update public.gs_candidate_identity i set casting_id=new.casting_id
 from public.candidates c where c.id=i.candidate_id and c.group_id=new.id and i.casting_id is null;
 return new;
end;
$$;
revoke all on function gradesync_internal.link_candidate_identities() from public, anon, authenticated;
create trigger gs_link_candidate_identities after update of casting_id on public.competition_groups
 for each row when (old.casting_id is null and new.casting_id is not null)
 execute function gradesync_internal.link_candidate_identities();

create or replace function public.osc_update_candidate_profile(
 p_candidate uuid, p_group uuid, p_casting uuid, p_updated timestamptz, p_identity_updated timestamptz,
 p_name text, p_fields jsonb, p_mssv text, p_email text, p_consent boolean, p_private jsonb
) returns void language plpgsql security invoker set search_path = ''
as $$
declare
 v_group public.competition_groups%rowtype;
 v_candidate public.candidates%rowtype;
 v_identity public.gs_candidate_identity%rowtype;
begin
 select * into v_group from public.competition_groups where id=p_group for share;
 if not found or v_group.casting_id is distinct from p_casting then
  raise exception 'GS_CANDIDATE_CHANGED';
 end if;
 if p_casting is not null then
  perform 1 from public.gs_castings where id=p_casting and status not in ('published','archived') for share;
  if not found then raise exception 'GS_CANDIDATE_PUBLISHED'; end if;
 end if;
 select * into v_candidate from public.candidates where id=p_candidate and group_id=p_group for update;
 if not found or v_candidate.updated_at is distinct from p_updated then
  raise exception 'GS_CANDIDATE_CHANGED';
 end if;
 select * into v_identity from public.gs_candidate_identity where candidate_id=p_candidate for update;
 if v_identity.updated_at is distinct from p_identity_updated then raise exception 'GS_CANDIDATE_CHANGED'; end if;
 if p_mssv is distinct from v_identity.mssv and exists(
  select 1 from public.gs_casting_decisions where candidate_id=p_candidate and casting_id=p_casting and synced_at is not null
 ) then raise exception 'GS_CANDIDATE_SYNCED'; end if;
 insert into public.gs_candidate_identity(candidate_id,casting_id,mssv,email,email_consent,private_fields,updated_at)
 values(p_candidate,p_casting,p_mssv,p_email,p_consent,p_private,now())
 on conflict(candidate_id) do update set casting_id=excluded.casting_id,mssv=excluded.mssv,email=excluded.email,
  email_consent=excluded.email_consent,private_fields=excluded.private_fields,updated_at=excluded.updated_at;
 update public.candidates set name=p_name,custom_fields=p_fields,updated_at=now() where id=p_candidate;
end;
$$;
revoke all on function public.osc_update_candidate_profile(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,text,boolean,jsonb)
 from public, anon, authenticated;
grant execute on function public.osc_update_candidate_profile(uuid,uuid,uuid,timestamptz,timestamptz,text,jsonb,text,text,boolean,jsonb)
 to service_role;

-- Serialize queue creation per casting/kind, including explicit resends.
create or replace function public.osc_queue_casting_notices(
 p_casting uuid, p_kind text, p_recipients text[], p_new_only boolean
) returns integer language plpgsql security invoker set search_path = ''
as $$
declare v_count integer;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_casting::text||':'||p_kind,0));
 insert into public.gs_casting_notifications(casting_id,event_type,recipient_email,status)
 select p_casting,p_kind,email,'queued'
 from unnest(p_recipients) as recipients(email)
 where not exists(
  select 1 from public.gs_casting_notifications n where n.casting_id=p_casting and n.event_type=p_kind
   and n.recipient_email=recipients.email and (p_new_only or n.status='queued')
 )
 limit 40;
 get diagnostics v_count = row_count;
 return v_count;
end;
$$;
revoke all on function public.osc_queue_casting_notices(uuid,text,text[],boolean) from public,anon,authenticated;
grant execute on function public.osc_queue_casting_notices(uuid,text,text[],boolean) to service_role;
notify pgrst, 'reload schema';
