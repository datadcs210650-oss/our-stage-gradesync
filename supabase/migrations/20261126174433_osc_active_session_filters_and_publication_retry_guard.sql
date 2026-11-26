-- Active session scope is shared by legacy admin document reads and new result filters.
CREATE OR REPLACE FUNCTION public.osc_grading_documents(ops jsonb, actor_uid text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 op jsonb; tbl text; kind text; keycol text; docid text; pair text[];
 rowdata jsonb; prev jsonb; result jsonb := '[]'; value jsonb; criterion jsonb;
 colnames text; values_sql text; assigns text; grader uuid; scope_id uuid;
 page_no integer; stamp text; active_filter text;
begin
 if jsonb_typeof(ops) <> 'array' or jsonb_array_length(ops) not between 1 and 1000 or coalesce(actor_uid,'')='' then raise exception 'Invalid batch'; end if;
 for op in select * from jsonb_array_elements(ops) loop
  tbl:=op->>'table'; kind:=op->>'kind'; docid:=op->>'id'; rowdata:=coalesce(op->'row','{}'); prev:=null; grader:=null; scope_id:=null;
  if tbl is null or tbl not in ('competition_groups','candidates','scores','grader_verifications','audit_logs','attendance_realtime','group_publication_index','grader_sessions','submission_notifications','profiles') then raise exception 'Unsupported collection'; end if;
  keycol:=case when tbl='group_publication_index' then 'group_id' else 'id' end;
  criterion:=coalesce(op->'match','{}');
  if jsonb_typeof(criterion)<>'object' or jsonb_typeof(rowdata)<>'object' then raise exception 'Invalid document'; end if;
  if tbl='profiles' then criterion:=criterion||'{"role":"Grader"}'::jsonb; end if;
  if docid is not null and tbl in ('scores','grader_verifications') then
   pair:=regexp_match(docid,'^(.+)_([0-9a-fA-F-]{36})$');
   if pair is not null then
    select id into grader from public.profiles where code=pair[1] and role='Grader';
    scope_id:=pair[2]::uuid;
    if grader is null then
     if kind in ('read','delete') then result:=result||jsonb_build_array('[]'::jsonb); continue; end if;
     raise exception 'Unknown grader';
    end if;
    criterion:=criterion||jsonb_build_object('grader_id',grader,case when tbl='scores' then 'candidate_id' else 'group_id' end,scope_id);
    docid:=null;
   end if;
  end if;
  if docid is not null then criterion:=criterion||jsonb_build_object(keycol,docid); end if;
  if kind='read' then
   page_no:=coalesce((op->>'page')::int,0);
   if page_no<0 then raise exception 'Invalid page'; end if;
   active_filter:=case when tbl='competition_groups' then ' and t.osc_deleted_at is null'
    when tbl in ('candidates','scores','grader_verifications','attendance_realtime','group_publication_index','submission_notifications') then ' and exists(select 1 from public.competition_groups g where g.id=t.group_id and g.osc_deleted_at is null)'
    else '' end;
   execute format('select coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) from (select t.* from public.%I t where to_jsonb(t) @> $1%s order by %I limit 100 offset $2) q',tbl,active_filter,keycol) into value using criterion,page_no::bigint*100;
  else
   if kind not in ('set','add','delete') or kind is null or (docid is null and scope_id is null) then raise exception 'Invalid operation'; end if;
   if tbl='grader_sessions' or (tbl='audit_logs' and kind<>'add') then raise exception 'Read only'; end if;
   if tbl='profiles' and (kind<>'set' or rowdata - array['name','assigned_groups','assigned_group_meta','assigned_group_names','permissions_version','permissions_updated_at','updated_at'] <> '{}'::jsonb) then raise exception 'Use the grader account manager'; end if;
   perform pg_advisory_xact_lock(hashtextextended(tbl||':'||criterion::text,0));
   execute format('select to_jsonb(t) from public.%I t where to_jsonb(t) @> $1 for update',tbl) into prev using criterion;
   if tbl='profiles' and prev is null then raise exception 'Unknown grader'; end if;
   if op ? 'revision' and coalesce((prev->>'revision')::int,0)<>(op->>'revision')::int then raise exception 'SCORE_CONFLICT'; end if;
   if kind='delete' then
    if prev is not null then execute format('delete from public.%I where %I::text=$1',tbl,keycol) using prev->>keycol; end if;
    value:='null';
   else
    if criterion - array[keycol,'role','candidate_id','grader_id','group_id'] <> '{}'::jsonb or op ? 'match' then raise exception 'Unexpected write filter'; end if;
    if tbl in ('scores','grader_verifications','audit_logs','submission_notifications') and rowdata ? 'grader_code' then
     select id into grader from public.profiles where code=rowdata->>'grader_code' and role='Grader';
     if grader is not null then rowdata:=rowdata||jsonb_build_object('grader_id',grader); end if;
    end if;
    rowdata:=rowdata || (criterion-'role');
    if tbl in ('scores','grader_verifications') and rowdata ? 'grader_id' and not exists(select 1 from public.profiles where id=(rowdata->>'grader_id')::uuid and role='Grader') then raise exception 'Invalid grader'; end if;
    if tbl='scores' and rowdata ? 'candidate_id' then
     select group_id into scope_id from public.candidates where id=(rowdata->>'candidate_id')::uuid;
     if scope_id is null or (rowdata ? 'group_id' and rowdata->>'group_id'<>scope_id::text) then raise exception 'Candidate group mismatch'; end if;
     rowdata:=rowdata||jsonb_build_object('group_id',scope_id);
    end if;
    if tbl='audit_logs' then rowdata:=rowdata||jsonb_build_object('details',coalesce(rowdata->'details','{}')||jsonb_build_object('oscActorUid',actor_uid)); end if;
    if prev is not null and rowdata ? 'extra_data' then rowdata:=rowdata||jsonb_build_object('extra_data',coalesce(prev->'extra_data','{}')||(rowdata->'extra_data')); end if;
    if prev is not null then rowdata:=rowdata-keycol; end if;
    select string_agg(format('%I',k),','),string_agg(format('r.%I',k),','),string_agg(format('%I=r.%I',k,k),',') into colnames,values_sql,assigns from jsonb_object_keys(rowdata) k;
    if prev is null then
     execute format('insert into public.%1$I as t (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) r returning to_jsonb(t)',tbl,colnames,values_sql) into value using rowdata;
    elsif kind='add' then raise exception 'Document already exists';
    elsif assigns is null then value:=prev;
    else
     execute format('update public.%1$I t set %2$s from jsonb_populate_record(null::public.%1$I,$1) r where t.%3$I::text=$2 returning to_jsonb(t)',tbl,assigns,keycol) into value using rowdata,prev->>keycol;
    end if;
    if tbl='profiles' and rowdata ? 'assigned_groups' then
     delete from public.grader_assignments where grader_id=docid::uuid and group_id not in(select g::uuid from jsonb_array_elements_text(rowdata->'assigned_groups') g);
     insert into public.grader_assignments(grader_id,group_id) select docid::uuid,g::uuid from jsonb_array_elements_text(rowdata->'assigned_groups') g on conflict(grader_id,group_id) do nothing;
    end if;
   end if;
   if tbl<>'audit_logs' then insert into public.audit_logs(action,details) values('osc-'||kind,jsonb_build_object('collection',tbl,'id',coalesce(docid,op->>'id'),'oscActorUid',actor_uid)); end if;
  end if;
  result:=result||jsonb_build_array(value);
 end loop;
 return result;
end $function$
;
CREATE OR REPLACE FUNCTION public.osc_reserve_group_publication(p_casting uuid, p_batch text, p_rows jsonb, p_at timestamp with time zone, p_actor text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE st text; groups uuid[]; gid uuid; n integer; chosen jsonb;
BEGIN
 IF p_batch!~'^[a-f0-9]{64}$' OR coalesce(p_actor,'')='' OR p_at IS NULL OR p_at>now()+interval '29 days'
 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'GS_PUBLICATION_INVALID'; END IF;
 SELECT status INTO st FROM public.gs_castings WHERE id=p_casting FOR SHARE;
 IF NOT FOUND OR st IN ('archived','published') THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 SELECT array_agg(DISTINCT c.group_id),count(*) INTO groups,n
 FROM jsonb_array_elements(p_rows) x JOIN public.candidates c ON c.id=(x->>'candidateId')::uuid
 JOIN public.competition_groups g ON g.id=c.group_id AND g.casting_id=p_casting;
 IF n<>jsonb_array_length(p_rows) OR cardinality(groups)=0 THEN RAISE EXCEPTION 'GS_PUBLICATION_INVALID'; END IF;
 PERFORM 1 FROM public.competition_groups WHERE id=ANY(groups) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.competition_groups WHERE id=ANY(groups) AND osc_deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'GS_SESSION_NOT_FOUND'; END IF;
 IF EXISTS(SELECT 1 FROM public.osc_group_publications WHERE group_id=ANY(groups) AND cancelled_at IS NULL AND batch_key<>p_batch) THEN RAISE EXCEPTION 'GS_PUBLICATION_ALREADY_RESERVED'; END IF;
 FOR chosen IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id JOIN public.competition_groups g ON g.id=c.group_id
   WHERE d.casting_id=p_casting AND d.candidate_id=(chosen->>'candidateId')::uuid AND d.review_status='approved' AND d.outcome=chosen->>'outcome'
   AND d.score IS NOT NULL AND to_jsonb(d.assigned_roles)=coalesce(chosen->'assignedRoles','[]'::jsonb)
   AND EXISTS(SELECT 1 FROM public.gs_candidate_identity i WHERE i.candidate_id=c.id AND i.email_consent IS TRUE AND coalesce(i.email,'')<>'')
   AND (coalesce(g.extra_data->'attendanceEnabled','false'::jsonb)<>'true'::jsonb OR c.is_present))
  THEN RAISE EXCEPTION 'GS_PUBLICATION_RESULT_CHANGED'; END IF;
 END LOOP;
 FOREACH gid IN ARRAY groups LOOP
  IF EXISTS(SELECT 1 FROM public.candidates c JOIN public.competition_groups g ON g.id=c.group_id
   LEFT JOIN public.gs_casting_decisions d ON d.candidate_id=c.id AND d.casting_id=g.casting_id
   WHERE c.group_id=gid AND (coalesce(g.extra_data->'attendanceEnabled','false'::jsonb)<>'true'::jsonb OR c.is_present)
   AND d.review_status IS DISTINCT FROM 'approved') THEN RAISE EXCEPTION 'GS_PUBLICATION_PENDING'; END IF;
  INSERT INTO public.osc_group_publications(group_id,casting_id,batch_key,scheduled_at,actor_uid) VALUES(gid,p_casting,p_batch,p_at,p_actor)
   ON CONFLICT(group_id,batch_key) DO NOTHING;
  IF EXISTS(SELECT 1 FROM public.osc_group_publications WHERE group_id=gid AND batch_key=p_batch AND cancelled_at IS NOT NULL) THEN RAISE EXCEPTION 'GS_PUBLICATION_CANCELLED'; END IF;
  INSERT INTO public.audit_logs(group_id,action,details) VALUES(gid,'osc-publication-reserved',jsonb_build_object('actorUid',p_actor,'batch',p_batch,'publishAt',p_at));
 END LOOP;
 RETURN cardinality(groups);
END $function$
;
-- A signed OSC server request may release its reservation only after a definitive
-- provider rejection with zero accepted recipients. Uncertain sends are not released.
create or replace function public.osc_abort_group_publication(p_casting uuid,p_batch text,p_actor text)
returns integer language plpgsql security invoker set search_path='' as $$
declare n integer; r record;
begin
 if p_batch!~'^[a-f0-9]{64}$' or coalesce(p_actor,'')='' then raise exception 'GS_PUBLICATION_INVALID';end if;
 perform 1 from public.competition_groups g join public.osc_group_publications p on p.group_id=g.id
 where p.casting_id=p_casting and p.batch_key=p_batch order by g.id for update of g;
 update public.osc_group_publications set cancelled_at=now() where casting_id=p_casting and batch_key=p_batch and cancelled_at is null and actor_uid=p_actor;
 get diagnostics n=row_count;
 for r in select group_id from public.osc_group_publications where casting_id=p_casting and batch_key=p_batch and actor_uid=p_actor loop
  insert into public.audit_logs(group_id,action,details) values(r.group_id,'osc-publication-provider-rejected',jsonb_build_object('actorUid',p_actor,'batch',p_batch));
 end loop;
 return n;
end $$;
revoke all on function public.osc_abort_group_publication(uuid,text,text) from public,anon,authenticated;
grant execute on function public.osc_abort_group_publication(uuid,text,text) to service_role;
notify pgrst,'reload schema';