CREATE OR REPLACE FUNCTION public.osc_mutate_candidate_roster(p_group uuid, p_casting uuid, p_version timestamp with time zone, p_operation text, p_rows jsonb, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare g public.competition_groups%rowtype; c public.candidates%rowtype; r jsonb; cid uuid; st text; n integer:=0; inserted_count integer:=0; filled_count integer:=0; skipped_count integer:=0; failures jsonb:='[]'; changed jsonb:='[]'; identity_version timestamptz; errtext text; existing_id uuid; existing_mssv text; existing_roles jsonb; incoming_roles jsonb;
begin
 if p_operation not in ('import','delete') or coalesce(p_actor,'')='' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'GS_ROSTER_INVALID';end if;
 select status into st from public.gs_castings where id=p_casting for share;
 if not found or st in ('published','archived') then raise exception 'GS_ROSTER_FINAL';end if;
 select * into g from public.competition_groups where id=p_group and casting_id=p_casting for update;
 if not found or g.osc_deleted_at is not null then raise exception 'GS_ROSTER_NOT_FOUND';end if;
 if g.updated_at is distinct from p_version then raise exception 'GS_ROSTER_CHANGED';end if;
 if exists(select 1 from public.osc_group_publications where group_id=g.id and cancelled_at is null) then raise exception 'GS_ROSTER_FINAL';end if;
 if exists(select 1 from public.grader_verifications where group_id=g.id and is_verified) or exists(select 1 from public.gs_grading_receipts where group_id=g.id) or exists(select 1 from gradesync_internal.attendance_locks where group_id=g.id) then raise exception 'GS_ROSTER_LOCKED';end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  begin
   if p_operation='import' then
    if coalesce(r->>'code','') !~ '^[A-Z0-9_-]{2,40}$' or length(coalesce(r->>'name','')) not between 2 and 120 or jsonb_typeof(r->'custom')<>'object' or jsonb_typeof(r->'privateFields')<>'object' then raise exception 'GS_ROSTER_INVALID_ROW';end if;
    select * into c from public.candidates where group_id=g.id and code=r->>'code' for update;
    if found then
     if r->>'fillMissingRoles' is distinct from 'true' then raise exception 'GS_ROSTER_DUPLICATE_CODE';end if;
     select mssv into existing_mssv from public.gs_candidate_identity where candidate_id=c.id for update;
     if nullif(r->>'mssv','') is null or existing_mssv is distinct from r->>'mssv' then raise exception 'GS_ROSTER_IDENTITY_MISMATCH';end if;
     existing_roles:=coalesce(c.custom_fields->'gsRoleIds','[]'::jsonb);
     incoming_roles:=coalesce(r->'custom'->'gsRoleIds','[]'::jsonb);
     if existing_roles @> incoming_roles and incoming_roles @> existing_roles then skipped_count:=skipped_count+1;continue;end if;
     if jsonb_array_length(existing_roles)>0 then raise exception 'GS_ROSTER_EXISTING_ROLES';end if;
     if jsonb_array_length(incoming_roles)=0 then skipped_count:=skipped_count+1;continue;end if;
     if exists(select 1 from public.scores where candidate_id=c.id) or exists(select 1 from public.gs_casting_decisions where candidate_id=c.id) or exists(select 1 from public.gs_membership_sync_queue where candidate_id=c.id) then raise exception 'GS_ROSTER_CANDIDATE_PROTECTED';end if;
     update public.candidates set custom_fields=jsonb_set(coalesce(custom_fields,'{}'::jsonb),'{gsRoleIds}',incoming_roles,true),updated_at=now() where id=c.id;
     cid:=c.id;filled_count:=filled_count+1;n:=n+1;changed:=changed||jsonb_build_array(jsonb_build_object('id',cid,'code',c.code,'operation','fill-roles'));continue;
    end if;
    if nullif(r->>'mssv','') is not null and exists(select 1 from public.gs_candidate_identity where casting_id=p_casting and mssv=r->>'mssv') then raise exception 'GS_ROSTER_DUPLICATE_MSSV';end if;
    insert into public.candidates(group_id,code,name,custom_fields,is_present) values(g.id,r->>'code',r->>'name',r->'custom',false) returning id into cid;
    insert into public.gs_candidate_identity(candidate_id,casting_id,mssv,email,email_consent,private_fields) values(cid,p_casting,nullif(r->>'mssv',''),nullif(r->>'email',''),false,r->'privateFields');
    inserted_count:=inserted_count+1;
   else
    cid:=(r->>'id')::uuid;
    select * into c from public.candidates where id=cid and group_id=g.id for update;
    if not found then raise exception 'GS_ROSTER_CANDIDATE_NOT_FOUND';end if;
    select updated_at into identity_version from public.gs_candidate_identity where candidate_id=cid for update;
    if c.updated_at is distinct from (r->>'version')::timestamptz or identity_version is distinct from (r->>'identityVersion')::timestamptz then raise exception 'GS_ROSTER_CANDIDATE_CHANGED';end if;
    if exists(select 1 from public.scores where candidate_id=cid) or exists(select 1 from public.gs_casting_decisions where candidate_id=cid) or exists(select 1 from public.gs_membership_sync_queue where candidate_id=cid) then raise exception 'GS_ROSTER_CANDIDATE_PROTECTED';end if;
    delete from public.candidates where id=cid and group_id=g.id;
   end if;
   n:=n+1;changed:=changed||jsonb_build_array(jsonb_build_object('id',cid,'code',case when p_operation='import' then r->>'code' else c.code end));
  exception when others then
   errtext:=case when sqlstate='23505' then 'GS_ROSTER_DUPLICATE' when sqlerrm like 'GS_ROSTER_%' or sqlerrm in ('INVALID_REGISTERED_ROLES','GS_ATTENDANCE_LOCKED') then sqlerrm else 'GS_ROSTER_WRITE_FAILED' end;
   failures:=failures||jsonb_build_array(jsonb_build_object('id',r->>'id','code',r->>'code','reason',errtext));
  end;
 end loop;
 if n>0 then insert into public.audit_logs(group_id,action,details) values(g.id,'osc-candidate-'||p_operation,jsonb_build_object('actorUid',p_actor,'count',n,'candidates',changed));end if;
 return jsonb_build_object('ok',true,'updated',n,'inserted',inserted_count,'filled',filled_count,'skipped',skipped_count,'failures',failures);
end $function$
;
notify pgrst,'reload schema';