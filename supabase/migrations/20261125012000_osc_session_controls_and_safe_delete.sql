create or replace function public.osc_session_controls()
returns table(group_id uuid, access_state text, can_open boolean, can_delete boolean, reason text)
language sql stable security invoker set search_path='' as $$
 select g.id,
 case when c.status in ('approved','published','archived') then 'closed'
      when g.close_at is not null and now()>=g.close_at then 'closed'
      when g.open_mode='auto' and g.open_at>now() then 'scheduled'
      when (g.open_mode='auto' and g.open_at<=now()) or (g.open_mode<>'auto' and g.is_open) then 'open' else 'closed' end,
 coalesce(c.status not in ('approved','published','archived'),true) and not exists(select 1 from public.gs_casting_decisions d join public.candidates x on x.id=d.candidate_id where x.group_id=g.id and (d.review_status<>'pending' or d.synced_at is not null)),
 coalesce(c.status not in ('approved','published','archived'),true) and not g.is_open and not (g.open_mode='auto' and g.open_at is not null and g.open_at<=now() and (g.close_at is null or g.close_at>now())) and not exists(select 1 from public.scores s where s.group_id=g.id) and not exists(select 1 from public.gs_grading_receipts r where r.group_id=g.id) and not exists(select 1 from public.grader_verifications v where v.group_id=g.id and v.is_verified) and not exists(select 1 from public.gs_casting_decisions d join public.candidates x on x.id=d.candidate_id where x.group_id=g.id) and not exists(select 1 from public.gs_reopened_score_sheets h where h.group_id=g.id),
 case when c.status in ('approved','published','archived') or exists(select 1 from public.gs_casting_decisions d join public.candidates x on x.id=d.candidate_id where x.group_id=g.id and (d.review_status<>'pending' or d.synced_at is not null)) then 'Đã duyệt hoặc công bố kết quả; giữ nguyên dữ liệu chính thức.' else '' end
 from public.competition_groups g left join public.gs_castings c on c.id=g.casting_id
$$;
revoke all on function public.osc_session_controls() from public,anon,authenticated;
grant execute on function public.osc_session_controls() to service_role;

create or replace function public.osc_manage_scoring_session(p_group uuid,p_action text,p_version timestamptz,p_name text,p_actor text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.competition_groups%rowtype; st text; ctl record; n bigint; v_open boolean; patch jsonb;
begin
 if coalesce(p_actor,'')='' or p_action not in ('open','close','delete') then raise exception 'GS_SESSION_INVALID'; end if;
 select * into g from public.competition_groups where id=p_group for update;
 if not found then raise exception 'GS_SESSION_NOT_FOUND'; end if;
 if g.updated_at is distinct from p_version then raise exception 'GS_SESSION_CHANGED'; end if;
 if g.casting_id is not null then select status into st from public.gs_castings where id=g.casting_id for update; end if;
 select * into ctl from public.osc_session_controls() where group_id=p_group;
 if p_action='delete' then
  if p_name is distinct from g.name then raise exception 'GS_SESSION_NAME'; end if;
  if not ctl.can_delete then raise exception 'GS_SESSION_DELETE_PROTECTED'; end if;
  select count(*) into n from public.candidates where group_id=g.id;
  insert into public.audit_logs(action,details) values('osc-session-deleted',jsonb_build_object('actorUid',p_actor,'groupId',g.id,'groupName',g.name,'castingId',g.casting_id,'candidateCount',n));
  delete from public.competition_groups where id=g.id;
  return jsonb_build_object('ok',true,'deleted',true,'candidateCount',n);
 end if;
 if st in ('published','archived') then raise exception 'GS_SESSION_FINAL'; end if;
 if g.open_mode='auto' then raise exception 'GS_SESSION_AUTO'; end if;
 v_open:=p_action='open';
 if v_open and not ctl.can_open then raise exception 'GS_SESSION_FINAL'; end if;
 if v_open and g.close_at is not null and g.close_at<=now() then raise exception 'GS_SESSION_EXPIRED'; end if;
 patch:=jsonb_build_object('isManuallyOpened',v_open,'isPublished',v_open,'visibleToGraders',true,'publishEnabled',true,'visibilityExplicitlySet',false,'publishAt',null,'publishUntil',g.close_at);
 update public.competition_groups set is_open=v_open,extra_data=coalesce(extra_data,'{}'::jsonb)||patch,updated_at=now() where id=g.id;
 insert into public.group_publication_index(group_id,open_at,close_at,updated_at,extra_data) values(g.id,null,g.close_at,now(),patch)
 on conflict(group_id) do update set open_at=null,close_at=excluded.close_at,updated_at=excluded.updated_at,extra_data=coalesce(public.group_publication_index.extra_data,'{}'::jsonb)||excluded.extra_data;
 insert into public.audit_logs(group_id,action,details) values(g.id,case when v_open then 'osc-session-opened' else 'osc-session-closed' end,jsonb_build_object('actorUid',p_actor,'groupId',g.id));
 return jsonb_build_object('ok',true,'isOpen',v_open);
end
$$;
revoke all on function public.osc_manage_scoring_session(uuid,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.osc_manage_scoring_session(uuid,text,timestamptz,text,text) to service_role;
notify pgrst,'reload schema';