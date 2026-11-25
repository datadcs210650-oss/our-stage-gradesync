create or replace function gradesync_internal.group_has_grading_history(p_group uuid)
returns boolean language sql stable set search_path = '' as $$
 select exists(select 1 from public.scores where group_id=p_group)
     or exists(select 1 from public.grader_verifications where group_id=p_group and is_verified)
     or exists(select 1 from public.gs_grading_receipts where group_id=p_group)
     or exists(select 1 from public.gs_reopened_score_sheets where group_id=p_group)
     or exists(select 1 from gradesync_internal.comparison_code_registry where group_id=p_group)
$$;

create or replace function gradesync_internal.guard_quorum_roster()
returns trigger language plpgsql security definer set search_path = '' as $$
declare gid uuid; jid uuid;
begin
 if tg_op='INSERT' then gid:=new.group_id; jid:=new.grader_id;
 else gid:=old.group_id; jid:=old.grader_id; end if;
 if tg_op='UPDATE' then
  if (new.grader_id,new.group_id) is distinct from (old.grader_id,old.group_id) then
   raise exception 'GS_ASSIGNMENT_IDENTITY_IMMUTABLE';
  end if;
  return new;
 end if;
 if tg_op='DELETE' and current_setting('role',true)='service_role'
    and current_setting('osc.delete_session_scope',true)=gid::text then return old; end if;
 perform 1 from public.competition_groups where id=gid for update;
 if tg_op='DELETE' and not found then return old; end if;
 if tg_op='INSERT' and exists(select 1 from public.grader_assignments where group_id=gid and grader_id=jid) then return new; end if;
 if gradesync_internal.group_has_grading_history(gid) then raise exception 'GS_QUORUM_ROSTER_LOCKED'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;

drop trigger gs_guard_quorum_roster on public.grader_assignments;
create trigger gs_guard_quorum_roster before insert or update or delete on public.grader_assignments
for each row execute function gradesync_internal.guard_quorum_roster();

create or replace function public.sync_profile_assignments_to_rows()
returns trigger language plpgsql security definer set search_path = '' as $$
declare wanted uuid[]:=coalesce(new.assigned_groups,'{}'); changed uuid[];
begin
 if new.role<>'Grader' then return new; end if;
 select array_agg(id) into changed from (
  select group_id id from public.grader_assignments where grader_id=new.id and not(group_id=any(wanted))
  union
  select w.group_id from unnest(wanted) w(group_id) where not exists (
   select 1 from public.grader_assignments where grader_id=new.id and group_id=w.group_id)
 ) delta;
 perform 1 from public.competition_groups where id=any(changed) order by id for update;
 with removed as (
  delete from public.grader_assignments where grader_id=new.id and not(group_id=any(wanted))
  returning group_id
 )
 delete from public.gs_criterion_grants c using removed r where c.grader_id=new.id and c.group_id=r.group_id;
 insert into public.grader_assignments(grader_id,group_id)
 select new.id,w.group_id from unnest(wanted) w(group_id) where not exists (
  select 1 from public.grader_assignments where grader_id=new.id and group_id=w.group_id)
 on conflict(grader_id,group_id) do nothing;
 return new;
end $$;

create or replace function gradesync_internal.grader_has_history(p_grader uuid)
returns boolean language sql stable set search_path = '' as $$
 select public.osc_judge_email_locked(p_grader)
     or exists(select 1 from public.scores where grader_id=p_grader)
     or exists(select 1 from public.grader_verifications where grader_id=p_grader and is_verified)
     or exists(select 1 from public.grader_assignments a join public.competition_groups g on g.id=a.group_id
        left join public.gs_castings c on c.id=g.casting_id where a.grader_id=p_grader
        and (c.status in ('published','archived') or gradesync_internal.group_has_grading_history(g.id)))
$$;

create or replace function gradesync_internal.guard_grader_profile_history()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if old.role<>'Grader' then
  if tg_op='DELETE' then return old; end if;
  return new;
 end if;
 if tg_op='DELETE' then
  perform 1 from public.competition_groups g join public.grader_assignments a on a.group_id=g.id
    where a.grader_id=old.id order by g.id for update of g;
  if gradesync_internal.grader_has_history(old.id) then raise exception 'GS_GRADER_HISTORY'; end if;
  return old;
 end if;
 if (new.status,new.role) is distinct from (old.status,old.role)
    and gradesync_internal.grader_has_history(old.id) then raise exception 'GS_GRADER_HISTORY'; end if;
 return new;
end $$;

create trigger gs_guard_grader_profile_history before delete or update of status,role on public.profiles
for each row execute function gradesync_internal.guard_grader_profile_history();

create or replace function gradesync_internal.guard_archived_grader_access()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
 if new.enabled and exists(select 1 from public.profiles p where p.id=new.profile_id and p.extra_data ? 'oscArchivedAt')
 then raise exception 'GS_GRADER_ARCHIVED'; end if;
 return new;
end $$;

create trigger gs_guard_archived_grader_access before insert or update on public.gs_google_grader_access
for each row execute function gradesync_internal.guard_archived_grader_access();

create or replace function public.osc_archive_grader(p_grader uuid, p_actor text)
returns void language plpgsql set search_path = '' as $$
begin
 update public.profiles set extra_data=coalesce(extra_data,'{}') ||
  case when extra_data ? 'oscArchivedAt' then '{}'::jsonb
       else jsonb_build_object('oscArchivedAt',now(),'oscArchivedBy',p_actor) end
 where id=p_grader and role='Grader';
 if not found then raise exception 'GS_GRADER_NOT_FOUND'; end if;
 update public.gs_google_grader_access set enabled=false,updated_at=now()
 where profile_id=p_grader and enabled;
end $$;

create or replace function public.osc_update_grader(p_grader uuid,p_name text,p_groups uuid[],
 p_change_email boolean,p_email text,p_revoke_link boolean)
returns void language plpgsql set search_path = '' as $$
declare access_row public.gs_google_grader_access%rowtype; judge public.profiles%rowtype;
begin
 select * into judge from public.profiles where id=p_grader and role='Grader' for update;
 if not found then raise exception 'GS_GRADER_NOT_FOUND'; end if;
 if judge.extra_data ? 'oscArchivedAt' then raise exception 'GS_GRADER_ARCHIVED'; end if;
 if p_change_email then
  select * into access_row from public.gs_google_grader_access where profile_id=p_grader for update;
  if access_row.email is distinct from p_email then
   if public.osc_judge_email_locked(p_grader) then raise exception 'GS_JUDGE_EMAIL_LOCKED'; end if;
   if access_row.auth_user_id is not null and not p_revoke_link then raise exception 'GS_JUDGE_GOOGLE_LINKED'; end if;
   if p_email is null then
    delete from public.gs_google_grader_access where profile_id=p_grader;
   else
    insert into public.gs_google_grader_access(profile_id,email,enabled)
    values(p_grader,p_email,true) on conflict(profile_id) do update
      set email=excluded.email,auth_user_id=null,enabled=true,updated_at=now();
   end if;
  end if;
 end if;
 update public.profiles set name=p_name,assigned_groups=p_groups,updated_at=now() where id=p_grader;
end $$;

create or replace function public.osc_set_grader_criteria(p_grader uuid,p_group uuid,p_criteria text[])
returns void language plpgsql security definer set search_path = '' as $$
declare config jsonb; existing text[];
begin
 perform 1 from public.profiles where id=p_grader and role='Grader' for share;
 if not found then raise exception 'GS_GRADER_NOT_FOUND'; end if;
 if exists(select 1 from public.profiles where id=p_grader and extra_data ? 'oscArchivedAt')
 then raise exception 'GS_GRADER_ARCHIVED'; end if;
 select criteria into config from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND'; end if;
 if not exists(select 1 from public.grader_assignments where grader_id=p_grader and group_id=p_group)
 then raise exception 'GS_NOT_ASSIGNED'; end if;
 if coalesce(cardinality(p_criteria),0)=0 or exists (
  select 1 from unnest(p_criteria) as name where not exists (
   select 1 from jsonb_array_elements(config) c where c->>'name'=name)
 ) then raise exception 'GS_INVALID_CRITERIA'; end if;
 select array_agg(criterion) into existing from public.gs_criterion_grants
  where grader_id=p_grader and group_id=p_group;
 if existing @> p_criteria and existing <@ p_criteria then return; end if;
 if exists(select 1 from public.scores where grader_id=p_grader and group_id=p_group)
    or exists(select 1 from public.grader_verifications where grader_id=p_grader and group_id=p_group and is_verified)
    or exists(select 1 from public.gs_grading_receipts where grader_id=p_grader and group_id=p_group)
    or exists(select 1 from public.gs_reopened_score_sheets where grader_id=p_grader and group_id=p_group)
    or exists(select 1 from gradesync_internal.comparison_code_registry where grader_id=p_grader and group_id=p_group)
 then raise exception 'GS_CRITERIA_HISTORY'; end if;
 insert into public.gs_criterion_grants(grader_id,group_id,criterion)
 select p_grader,p_group,name from unnest(p_criteria) name
 on conflict do nothing;
 delete from public.gs_criterion_grants where grader_id=p_grader and group_id=p_group
  and not(criterion=any(p_criteria));
end $$;

revoke execute on function public.osc_archive_grader(uuid,text),
 public.osc_update_grader(uuid,text,uuid[],boolean,text,boolean),
 public.osc_set_grader_criteria(uuid,uuid,text[]) from public, anon, authenticated;
grant execute on function public.osc_archive_grader(uuid,text),
 public.osc_update_grader(uuid,text,uuid[],boolean,text,boolean),
 public.osc_set_grader_criteria(uuid,uuid,text[]) to service_role;
revoke execute on function gradesync_internal.grader_has_history(uuid),
 gradesync_internal.group_has_grading_history(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.osc_superadmin_delete_session(p_group uuid, p_name text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.competition_groups%rowtype; n bigint; sc bigint; st text;
begin
 if coalesce(p_actor,'')='' then raise exception 'GS_SESSION_INVALID'; end if;
 select * into g from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND'; end if;
 if g.name is distinct from p_name then raise exception 'GS_SESSION_NAME'; end if;
 if g.casting_id is not null then select status into st from public.gs_castings where id=g.casting_id for update; end if;
 if st in ('published','archived') or g.is_open or gradesync_internal.group_has_grading_history(g.id)
    or exists(select 1 from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=g.id) then
  raise exception 'GS_SESSION_DELETE_PROTECTED';
 end if;
 select count(*) into n from public.candidates where group_id=g.id;
 select count(*) into sc from public.scores where group_id=g.id;
 perform pg_catalog.set_config('osc.delete_session_scope',g.id::text,true);
 delete from public.gs_casting_decisions d using public.candidates c where d.candidate_id=c.id and c.group_id=g.id;
 delete from public.gs_candidate_identity d using public.candidates c where d.candidate_id=c.id and c.group_id=g.id;
 delete from public.competition_groups where id=g.id;
 perform pg_catalog.set_config('osc.delete_session_scope','',true);
 update public.profiles set assigned_groups=array_remove(assigned_groups,p_group)
  where p_group=any(assigned_groups);
 insert into public.audit_logs(action,details) values('osc-session-deleted',jsonb_build_object('actorUid',p_actor,'actorRole','superadmin','groupId',g.id,'groupName',g.name,'castingId',g.casting_id,'previousStatus',st,'wasOpen',g.is_open,'candidateCount',n,'scoreCount',sc));
 return jsonb_build_object('ok',true,'deleted',true,'candidateCount',n,'scoreCount',sc);
end
$function$
;

create or replace function public.osc_grader_history_protected(p_grader uuid)
returns boolean language sql stable security definer set search_path = '' as $$
 select gradesync_internal.grader_has_history(p_grader)
$$;
revoke execute on function public.osc_grader_history_protected(uuid) from public, anon, authenticated;
grant execute on function public.osc_grader_history_protected(uuid) to service_role;
