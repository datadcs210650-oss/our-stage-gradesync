-- Manager-only document operations for the OSC copy of the GradeSync console.
-- Each submitted batch is a single transaction. The service endpoint verifies
-- the current OSC manager before supplying actor_uid.
create or replace function public.osc_grading_documents(ops jsonb, actor_uid text)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public as $$
declare
 op jsonb; tbl text; kind text; keycol text; docid text; pair text[];
 rowdata jsonb; prev jsonb; result jsonb := '[]'; value jsonb; criterion jsonb;
 colnames text; values_sql text; assigns text; grader uuid; scope_id uuid;
 page_no integer; stamp text;
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
   execute format('select coalesce(jsonb_agg(to_jsonb(q)),''[]''::jsonb) from (select t.* from public.%I t where to_jsonb(t) @> $1 order by %I limit 100 offset $2) q',tbl,keycol) into value using criterion,page_no::bigint*100;
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
end $$;
revoke all on function public.osc_grading_documents(jsonb,text) from public, anon, authenticated;
grant execute on function public.osc_grading_documents(jsonb,text) to service_role;