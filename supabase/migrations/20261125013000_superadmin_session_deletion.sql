CREATE OR REPLACE FUNCTION gradesync_internal.guard_completed_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'gradesync_internal'
AS $function$
declare oldj jsonb:='{}'; newj jsonb:='{}'; rowj jsonb; cid uuid; gid uuid; st text;
begin
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
end $function$;
create or replace function public.osc_superadmin_delete_session(p_group uuid,p_name text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.competition_groups%rowtype; n bigint; sc bigint; st text;
begin
 if coalesce(p_actor,'')='' then raise exception 'GS_SESSION_INVALID'; end if;
 select * into g from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND'; end if;
 if g.name is distinct from p_name then raise exception 'GS_SESSION_NAME'; end if;
 if g.casting_id is not null then select status into st from public.gs_castings where id=g.casting_id for update; end if;
 select count(*) into n from public.candidates where group_id=g.id;
 select count(*) into sc from public.scores where group_id=g.id;
 perform pg_catalog.set_config('osc.delete_session_scope',g.id::text,true);
 delete from public.gs_casting_decisions d using public.candidates c where d.candidate_id=c.id and c.group_id=g.id;
 delete from public.gs_candidate_identity d using public.candidates c where d.candidate_id=c.id and c.group_id=g.id;
 delete from public.competition_groups where id=g.id;
 perform pg_catalog.set_config('osc.delete_session_scope','',true);
 insert into public.audit_logs(action,details) values('osc-session-deleted',jsonb_build_object('actorUid',p_actor,'actorRole','superadmin','groupId',g.id,'groupName',g.name,'castingId',g.casting_id,'previousStatus',st,'wasOpen',g.is_open,'candidateCount',n,'scoreCount',sc));
 return jsonb_build_object('ok',true,'deleted',true,'candidateCount',n,'scoreCount',sc);
end
$$;
revoke all on function public.osc_superadmin_delete_session(uuid,text,text) from public,anon,authenticated;
grant execute on function public.osc_superadmin_delete_session(uuid,text,text) to service_role;
notify pgrst,'reload schema';