-- Published sessions are removed from active management, preserving immutable results and receipts.
alter table public.competition_groups add column if not exists osc_deleted_at timestamptz;
CREATE OR REPLACE FUNCTION gradesync_internal.guard_completed_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'gradesync_internal'
AS $function$
declare oldj jsonb:='{}'; newj jsonb:='{}'; rowj jsonb; cid uuid; gid uuid; st text;
begin
 if tg_table_name='competition_groups' then
  if tg_op='INSERT' and (to_jsonb(new)->>'osc_deleted_at') is not null then raise exception 'GS_SESSION_DELETE_PROTECTED'; end if;
  if tg_op='UPDATE' and (to_jsonb(new)->'osc_deleted_at') is distinct from (to_jsonb(old)->'osc_deleted_at') then
   if current_setting('role',true)='service_role' and current_setting('osc.archive_session_scope',true)=to_jsonb(old)->>'id'
      and (to_jsonb(old)->>'osc_deleted_at') is null and (to_jsonb(new)->>'osc_deleted_at') is not null
      and (to_jsonb(old)-'osc_deleted_at'-'updated_at')=(to_jsonb(new)-'osc_deleted_at'-'updated_at') then return new;end if;
   raise exception 'GS_SESSION_DELETE_PROTECTED';
  end if;
 end if;
 if tg_op='DELETE' then
  oldj:=to_jsonb(old);
  if current_setting('role',true)='service_role' then
   gid:=null;
   if tg_table_name='competition_groups' then gid:=(oldj->>'id')::uuid;
   elsif tg_table_name in ('gs_candidate_identity','gs_casting_decisions') then
    select group_id into gid from public.candidates where id=(oldj->>'candidate_id')::uuid;
   elsif oldj ? 'group_id' then gid:=(oldj->>'group_id')::uuid;
   end if;
   if gid::text=current_setting('osc.delete_session_scope',true) then return old; end if;
  end if;
  if tg_table_name='competition_groups' then raise exception 'GS_SESSION_SUPERADMIN_DELETE_REQUIRED'; end if;
 end if;
 if tg_op<>'INSERT' then oldj:=to_jsonb(old);end if;
 if tg_op<>'DELETE' then newj:=to_jsonb(new);end if;
 if tg_table_name='gs_castings' then
  if oldj->>'status' in ('published','archived') then
   if tg_op='UPDATE' and (oldj-'status'-'updated_at')=(newj-'status'-'updated_at')
      and (newj->>'status'=oldj->>'status' or (oldj->>'status'='published' and newj->>'status'='archived')) then return new;end if;
   raise exception 'Phiên chấm đã hoàn tất.';
  end if;
 elsif tg_table_name='gs_grading_receipts' and tg_op='UPDATE' then
  raise exception 'Biên bản xác nhận đã khóa.';
 else
  for rowj in select oldj union all select newj loop
   cid:=null;gid:=null;
   if tg_table_name in ('gs_casting_decisions','gs_candidate_identity','gs_candidate_fields','competition_groups') then
    cid:=(rowj->>'casting_id')::uuid;
   else
    gid:=(rowj->>'group_id')::uuid;
    if gid is not null then select casting_id into cid from public.competition_groups where id=gid;end if;
   end if;
   if tg_table_name='competition_groups' then gid:=(rowj->>'id')::uuid;
   elsif tg_table_name in ('gs_casting_decisions','gs_candidate_identity') then select group_id into gid from public.candidates where id=(rowj->>'candidate_id')::uuid; end if;
   if (gid is not null and exists(select 1 from public.osc_group_publications p where p.group_id=gid and p.cancelled_at is null))
     or (tg_table_name='gs_candidate_fields' and exists(select 1 from public.osc_group_publications p where p.casting_id=cid and p.cancelled_at is null)) then
     if tg_table_name='gs_casting_decisions' and tg_op='UPDATE' and (oldj-'synced_at'-'member_id'-'updated_at')=(newj-'synced_at'-'member_id'-'updated_at') then return new; end if;
     if tg_table_name='gs_candidate_identity' and tg_op='UPDATE' and (oldj-'email_consent'-'updated_at')=(newj-'email_consent'-'updated_at') and newj->>'email_consent'='false' then return new; end if;
     raise exception 'Phiên chấm đã hoàn tất.';
   end if;
   if cid is not null then
    select status into st from public.gs_castings where id=cid for share;
    if st in ('published','archived') then
     if tg_table_name='gs_casting_decisions' and tg_op='UPDATE'
       and (oldj-'synced_at'-'member_id'-'updated_at')=(newj-'synced_at'-'member_id'-'updated_at') then return new;end if;
     if tg_table_name='gs_candidate_identity' and tg_op='UPDATE'
       and (oldj-'email_consent'-'updated_at')=(newj-'email_consent'-'updated_at') and newj->>'email_consent'='false' then return new;end if;
     raise exception 'Phiên chấm đã hoàn tất.';
    end if;
   end if;
  end loop;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end $function$
;
create or replace function public.osc_grader_session_access(p_group uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.grader_assignments a
 join public.competition_groups g on g.id=a.group_id
 left join public.gs_castings c on c.id=g.casting_id
 where a.group_id=p_group and a.grader_id=public.gs_current_grader_id()
 and g.osc_deleted_at is null
 and not coalesce(c.status='archived' or (c.status='published' and coalesce(c.publish_at,now())<=now()),false)
 and not exists(select 1 from public.osc_group_publications p where p.group_id=g.id and p.cancelled_at is null and p.scheduled_at<=now()))
$$;
revoke all on function public.osc_grader_session_access(uuid) from public,anon;
grant execute on function public.osc_grader_session_access(uuid) to authenticated,service_role;
create or replace function public.osc_grader_visible_sessions()
returns table(group_id uuid, hide_at timestamptz) language sql stable security definer set search_path='' as $$
 select g.id, least(case when c.status='published' then c.publish_at end,
 (select min(p.scheduled_at) from public.osc_group_publications p where p.group_id=g.id and p.cancelled_at is null))
 from public.grader_assignments a join public.competition_groups g on g.id=a.group_id
 left join public.gs_castings c on c.id=g.casting_id
 where a.grader_id=public.gs_current_grader_id() and public.osc_grader_session_access(g.id)
$$;
revoke all on function public.osc_grader_visible_sessions() from public,anon,authenticated;
grant execute on function public.osc_grader_visible_sessions() to authenticated;
create or replace function public.osc_archive_published_session(p_group uuid,p_name text,p_version timestamptz,p_actor text,p_actor_role text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.competition_groups%rowtype; c public.gs_castings%rowtype; cid uuid; t timestamptz;
begin
 if coalesce(p_actor,'')='' or p_actor_role not in ('admin','superadmin') then raise exception 'GS_SESSION_INVALID';end if;
 select casting_id into cid from public.competition_groups where id=p_group;
 if not found then raise exception 'GS_SESSION_NOT_FOUND';end if;
 if cid is not null then select * into c from public.gs_castings where id=cid for share;end if;
 select * into g from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND';end if;
 if g.casting_id is distinct from cid then raise exception 'GS_SESSION_CHANGED';end if;
 if g.name is distinct from p_name then raise exception 'GS_SESSION_NAME';end if;
 if g.osc_deleted_at is not null then return jsonb_build_object('ok',true,'deleted',true,'archived',true);end if;
 if g.updated_at is distinct from p_version then raise exception 'GS_SESSION_CHANGED';end if;
 if not (coalesce(c.status='archived' or (c.status='published' and coalesce(c.publish_at,now())<=now()),false)
 or exists(select 1 from public.osc_group_publications p where p.group_id=g.id and p.cancelled_at is null and p.scheduled_at<=now())) then
 raise exception 'GS_SESSION_NOT_PUBLISHED';end if;
 if exists(select 1 from public.osc_group_publications p where p.group_id=g.id and p.cancelled_at is null and p.scheduled_at>now()) then raise exception 'GS_SESSION_PUBLICATION_SCHEDULED';end if;
 t:=clock_timestamp();
 perform pg_catalog.set_config('osc.archive_session_scope',g.id::text,true);
 update public.competition_groups set osc_deleted_at=t where id=g.id;
 perform pg_catalog.set_config('osc.archive_session_scope','',true);
 insert into public.audit_logs(group_id,action,details) values(g.id,'osc-published-session-removed',jsonb_build_object('actorUid',p_actor,'actorRole',p_actor_role,'groupId',g.id,'groupName',g.name,'castingId',g.casting_id,'removedAt',t));
 return jsonb_build_object('ok',true,'deleted',true,'archived',true);
end
$$;
revoke all on function public.osc_archive_published_session(uuid,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.osc_archive_published_session(uuid,text,timestamptz,text,text) to service_role;
create or replace function gradesync_internal.emit_publication_group_signal() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.gs_change_signal set version=version+1 where scope='competition_groups'; return coalesce(new,old);end $$;
drop trigger if exists osc_publication_change_signal on public.osc_group_publications;
create trigger osc_publication_change_signal after insert or update or delete on public.osc_group_publications for each row execute function gradesync_internal.emit_publication_group_signal();
notify pgrst,'reload schema';