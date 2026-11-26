
CREATE TABLE public.osc_group_publications(
 group_id uuid NOT NULL REFERENCES public.competition_groups(id) ON DELETE CASCADE,
 casting_id uuid NOT NULL REFERENCES public.gs_castings(id) ON DELETE CASCADE,
 batch_key text NOT NULL CHECK(batch_key~'^[a-f0-9]{64}$'),
 scheduled_at timestamptz NOT NULL, reserved_at timestamptz NOT NULL DEFAULT now(),
 actor_uid text NOT NULL, cancelled_at timestamptz,
 PRIMARY KEY(group_id,batch_key)
);
ALTER TABLE public.osc_group_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.osc_group_publications FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.osc_group_publications TO service_role;
CREATE INDEX osc_group_publication_active ON public.osc_group_publications(group_id,scheduled_at) WHERE cancelled_at IS NULL;
CREATE OR REPLACE FUNCTION public.osc_session_publication_meta()
RETURNS TABLE(group_id uuid,publish_at timestamptz)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=''
AS $f$
 SELECT p.group_id,min(p.scheduled_at) FROM public.osc_group_publications p WHERE p.cancelled_at IS NULL GROUP BY p.group_id
$f$;
REVOKE ALL ON FUNCTION public.osc_session_publication_meta() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.osc_session_publication_meta() TO service_role;
CREATE OR REPLACE FUNCTION public.osc_reserve_group_publication(p_casting uuid,p_batch text,p_rows jsonb,p_at timestamptz,p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE st text; groups uuid[]; gid uuid; n integer; chosen jsonb;
BEGIN
 IF p_batch!~'^[a-f0-9]{64}$' OR coalesce(p_actor,'')='' OR p_at IS NULL OR p_at>now()+interval '29 days'
 OR jsonb_typeof(p_rows)<>'array' OR jsonb_array_length(p_rows) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'GS_PUBLICATION_INVALID'; END IF;
 SELECT status INTO st FROM public.gs_castings WHERE id=p_casting FOR SHARE;
 IF NOT FOUND OR st='archived' THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 SELECT array_agg(DISTINCT c.group_id),count(*) INTO groups,n
 FROM jsonb_array_elements(p_rows) x JOIN public.candidates c ON c.id=(x->>'candidateId')::uuid
 JOIN public.competition_groups g ON g.id=c.group_id AND g.casting_id=p_casting;
 IF n<>jsonb_array_length(p_rows) OR cardinality(groups)=0 THEN RAISE EXCEPTION 'GS_PUBLICATION_INVALID'; END IF;
 PERFORM 1 FROM public.competition_groups WHERE id=ANY(groups) ORDER BY id FOR UPDATE;
 FOR chosen IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
  IF NOT EXISTS(SELECT 1 FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id JOIN public.competition_groups g ON g.id=c.group_id
   WHERE d.casting_id=p_casting AND d.candidate_id=(chosen->>'candidateId')::uuid AND d.review_status='approved' AND d.outcome=chosen->>'outcome'
   AND to_jsonb(d.assigned_roles)=coalesce(chosen->'assignedRoles','[]'::jsonb)
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
END $f$;
REVOKE ALL ON FUNCTION public.osc_reserve_group_publication(uuid,text,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.osc_reserve_group_publication(uuid,text,jsonb,timestamptz,text) TO service_role;
CREATE OR REPLACE FUNCTION public.osc_release_group_publication(p_casting uuid,p_batch text,p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE n integer; r record;
BEGIN
 IF p_batch!~'^[a-f0-9]{64}$' OR coalesce(p_actor,'')='' THEN RAISE EXCEPTION 'GS_PUBLICATION_INVALID'; END IF;
 PERFORM 1 FROM public.competition_groups g JOIN public.osc_group_publications p ON p.group_id=g.id WHERE p.casting_id=p_casting AND p.batch_key=p_batch ORDER BY g.id FOR UPDATE OF g;
 IF EXISTS(SELECT 1 FROM public.osc_group_publications WHERE casting_id=p_casting AND batch_key=p_batch AND cancelled_at IS NULL AND scheduled_at<=now()) THEN RAISE EXCEPTION 'GS_PUBLICATION_FINAL'; END IF;
 UPDATE public.osc_group_publications SET cancelled_at=now() WHERE casting_id=p_casting AND batch_key=p_batch AND cancelled_at IS NULL;
 GET DIAGNOSTICS n=ROW_COUNT;
 FOR r IN SELECT group_id FROM public.osc_group_publications WHERE casting_id=p_casting AND batch_key=p_batch LOOP
  INSERT INTO public.audit_logs(group_id,action,details) VALUES(r.group_id,'osc-publication-cancelled',jsonb_build_object('actorUid',p_actor,'batch',p_batch));
 END LOOP;
 RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.osc_release_group_publication(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.osc_release_group_publication(uuid,text,text) TO service_role;
CREATE OR REPLACE FUNCTION public.osc_grader_session_access(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT EXISTS (
  SELECT 1 FROM public.grader_assignments a JOIN public.competition_groups g ON g.id=a.group_id
  LEFT JOIN public.gs_castings c ON c.id=g.casting_id
  WHERE a.group_id=p_group AND a.grader_id=public.gs_current_grader_id()
  AND NOT((coalesce(c.status IN ('published','archived'),false) OR EXISTS(SELECT 1 FROM public.osc_group_publications p WHERE p.group_id=g.id AND p.cancelled_at IS NULL AND p.scheduled_at<=now()))
      AND coalesce(g.extra_data->'blockGraderAfterPublish'='true'::jsonb,true))
 )
$f$;

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
end $function$;

CREATE OR REPLACE FUNCTION public.osc_revise_session(p_group uuid, p_version timestamp with time zone, p_patch jsonb, p_actor text, p_confirm boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE g public.competition_groups%rowtype; n public.competition_groups%rowtype; st text; old_policy jsonb; new_policy jsonb; version_no integer; changed boolean; history boolean; r record; jobs uuid[]:='{}'; opened jsonb; score_rows jsonb; grants_rows jsonb; decisions_rows jsonb;
BEGIN
 IF coalesce(p_actor,'')='' OR jsonb_typeof(p_patch)<>'object' OR p_patch-ARRAY['name','criteria','pass_score','open_mode','open_at','close_at','is_open','extra_data','updated_at']<>'{}'::jsonb THEN RAISE EXCEPTION 'GS_INVALID_CONFIG'; END IF;
 PERFORM 1 FROM public.gs_otp_challenges WHERE group_id=p_group ORDER BY grader_id FOR UPDATE;
 SELECT * INTO g FROM public.competition_groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND OR g.updated_at IS DISTINCT FROM p_version THEN RAISE EXCEPTION 'GS_SESSION_CHANGED'; END IF;
 SELECT status INTO st FROM public.gs_castings WHERE id=g.casting_id FOR SHARE;
 IF st IN ('published','archived') OR EXISTS(SELECT 1 FROM public.osc_group_publications p WHERE p.group_id=p_group AND p.cancelled_at IS NULL) THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 n:=jsonb_populate_record(g,p_patch);
 IF jsonb_typeof(n.criteria)<>'array' OR jsonb_array_length(n.criteria) NOT BETWEEN 1 AND 20 OR n.pass_score NOT BETWEEN 0 AND 10 OR
 EXISTS(SELECT 1 FROM jsonb_array_elements(n.criteria) k WHERE jsonb_typeof(k->'name')<>'string' OR length(trim(k->>'name')) NOT BETWEEN 1 AND 100 OR jsonb_typeof(k->'weight')<>'number' OR (k->>'weight')::numeric NOT BETWEEN 0 AND 100)
 OR (SELECT count(DISTINCT lower(k->>'name')) FROM jsonb_array_elements(n.criteria) k)<>jsonb_array_length(n.criteria)
 OR abs((SELECT sum((k->>'weight')::numeric) FROM jsonb_array_elements(n.criteria) k)-100)>0.01 THEN RAISE EXCEPTION 'GS_INVALID_CONFIG'; END IF;
 old_policy:=g.extra_data->'gsCasting'; new_policy:=n.extra_data->'gsCasting';
 changed:=(n.criteria,n.pass_score,new_policy,n.extra_data->'gsRoleLimits') IS DISTINCT FROM (g.criteria,g.pass_score,old_policy,g.extra_data->'gsRoleLimits');
 history:=gradesync_internal.group_has_grading_history(p_group);
 IF history AND (coalesce(old_policy->'roles','[]'::jsonb),coalesce(old_policy->'notesEnabled','false'::jsonb),coalesce(old_policy->'maxRegistered','0'::jsonb),coalesce(old_policy->'maxProposed','0'::jsonb)) IS DISTINCT FROM (coalesce(new_policy->'roles','[]'::jsonb),coalesce(new_policy->'notesEnabled','false'::jsonb),coalesce(new_policy->'maxRegistered','0'::jsonb),coalesce(new_policy->'maxProposed','0'::jsonb)) THEN RAISE EXCEPTION 'GS_ROLE_CONFIG_HISTORY'; END IF;
 IF changed AND (history OR EXISTS(SELECT 1 FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id WHERE c.group_id=p_group AND d.review_status<>'pending')) THEN
  IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'GS_REVISION_CONFIRM_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id WHERE c.group_id=p_group AND d.synced_at IS NOT NULL) THEN RAISE EXCEPTION 'GS_SYNCED_DECISIONS'; END IF;
  IF EXISTS(SELECT 1 FROM public.gs_criterion_grants a WHERE a.group_id=p_group AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n.criteria) k WHERE k->>'name'=a.criterion)) THEN RAISE EXCEPTION 'GS_ASSIGNED_CRITERION_REMOVED'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(n.criteria) k WHERE NOT EXISTS(SELECT 1 FROM public.grader_assignments a WHERE a.group_id=p_group AND (NOT EXISTS(SELECT 1 FROM public.gs_criterion_grants x WHERE x.group_id=p_group AND x.grader_id=a.grader_id) OR EXISTS(SELECT 1 FROM public.gs_criterion_grants x WHERE x.group_id=p_group AND x.grader_id=a.grader_id AND x.criterion=k->>'name')))) THEN RAISE EXCEPTION 'GS_CRITERION_NO_GRADER'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(s)),'[]') INTO score_rows FROM public.scores s WHERE group_id=p_group;
  SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO grants_rows FROM public.gs_criterion_grants a WHERE group_id=p_group;
  SELECT coalesce(jsonb_agg(to_jsonb(d)),'[]') INTO decisions_rows FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id WHERE c.group_id=p_group;
  SELECT coalesce(max(version),0)+1 INTO version_no FROM public.osc_session_config_versions WHERE original_group_id=p_group;
  INSERT INTO public.osc_session_config_versions(group_id,original_group_id,version,actor_uid,prior_config,new_config,original_scores,original_grants,prior_decisions)
  VALUES(p_group,p_group,version_no,p_actor,to_jsonb(g),to_jsonb(n),score_rows,grants_rows,decisions_rows);
  UPDATE public.gs_castings SET status='review',updated_at=now() WHERE id=g.casting_id AND status='approved';
  UPDATE public.gs_casting_decisions d SET review_status='pending',outcome='pending',score=NULL,reviewed_by=NULL,reviewed_at=NULL,assigned_roles='{}',updated_at=now() FROM public.candidates c WHERE c.id=d.candidate_id AND c.group_id=p_group AND d.casting_id=g.casting_id;
  FOR r IN SELECT grader_id,comparison_code FROM public.gs_grading_receipts WHERE group_id=p_group ORDER BY grader_id LOOP
   opened:=public.osc_reopen_receipt(p_group,r.grader_id,r.comparison_code,'Thay đổi tiêu chí, trọng số hoặc điểm chuẩn; phiên bản '||version_no||'. Biên bản cũ hết hiệu lực. Vui lòng kiểm tra và xác nhận lại OTP.',p_actor);
   jobs:=array_append(jobs,(opened->>'jobId')::uuid);
  END LOOP;
  UPDATE public.gs_otp_challenges SET used_at=now() WHERE group_id=p_group AND used_at IS NULL;
  UPDATE public.osc_grading_pdf_issues SET superseded_at=now() WHERE group_id=p_group AND kind IN ('individual','aggregate') AND superseded_at IS NULL;
  n.extra_data:=coalesce(n.extra_data,'{}')||jsonb_build_object('configVersion',version_no);
  -- Keep legacy role structure; only validated scoring method/weights may change.
 END IF;
 PERFORM set_config('osc.config_scope',p_group::text,true);
 UPDATE public.competition_groups SET name=n.name,criteria=n.criteria,pass_score=n.pass_score,open_mode=n.open_mode,open_at=n.open_at,close_at=n.close_at,is_open=n.is_open,extra_data=n.extra_data,updated_at=now() WHERE id=p_group;
 PERFORM set_config('osc.config_scope','',true);
 IF version_no IS NOT NULL THEN
  -- Archive retains unmodified marks. Current rows contain only retained criterion keys.
  WITH recalculated AS (
   SELECT s.id,
    coalesce(jsonb_object_agg(k->>'name',s.scores->(k->>'name')) FILTER(WHERE s.scores ? (k->>'name')),'{}'::jsonb) marks,
    round(coalesce(sum(coalesce((s.scores->>(k->>'name'))::numeric,0)*(k->>'weight')::numeric),0)/nullif(sum((k->>'weight')::numeric),0),2) total
   FROM public.scores s CROSS JOIN LATERAL jsonb_array_elements(n.criteria) k
   JOIN public.candidates c ON c.id=s.candidate_id
   WHERE s.group_id=p_group AND (coalesce(n.extra_data->'attendanceEnabled','false'::jsonb)<>'true'::jsonb OR c.is_present)
   AND (NOT EXISTS(SELECT 1 FROM public.gs_criterion_grants x WHERE x.group_id=p_group AND x.grader_id=s.grader_id) OR EXISTS(SELECT 1 FROM public.gs_criterion_grants x WHERE x.group_id=p_group AND x.grader_id=s.grader_id AND x.criterion=k->>'name'))
   GROUP BY s.id)
  UPDATE public.scores s SET scores=calc.marks,total_score=coalesce(calc.total,0),revision=s.revision+1,updated_at=now() FROM recalculated calc WHERE s.id=calc.id AND (s.scores,s.total_score) IS DISTINCT FROM (calc.marks,coalesce(calc.total,0));
 END IF;
 INSERT INTO public.audit_logs(group_id,action,details) VALUES(p_group,'osc-session-config',jsonb_build_object('actorUid',p_actor,'version',version_no,'reopened',cardinality(jobs),'before',to_jsonb(g),'after',to_jsonb(n)));
 RETURN jsonb_build_object('ok',true,'version',version_no,'jobIds',jobs,'group',jsonb_build_object('id',p_group,'name',n.name));
END $function$;

CREATE OR REPLACE FUNCTION public.osc_save_session_assignments(p_group uuid, p_judges jsonb, p_send_at timestamp with time zone, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE g public.competition_groups%rowtype; st text; desired uuid[]; existing uuid[]; j record; names text[]; assigned text[]; job_ids uuid[]:='{}'; new_job uuid; jid uuid; entry jsonb; mail text; nm text;
BEGIN
 IF coalesce(p_actor,'')='' OR jsonb_typeof(p_judges)<>'array' OR jsonb_array_length(p_judges)>30 THEN RAISE EXCEPTION 'GS_INVALID_ASSIGNMENTS'; END IF;
 IF p_send_at IS NULL OR p_send_at>now()+interval '29 days' THEN RAISE EXCEPTION 'GS_INVITE_TIME_INVALID'; END IF;
 SELECT coalesce(array_agg((x->>'graderId')::uuid),'{}') INTO desired FROM jsonb_array_elements(p_judges) x;
 IF array_position(desired,NULL) IS NOT NULL OR cardinality(desired)<>(SELECT count(DISTINCT x) FROM unnest(desired) x) THEN RAISE EXCEPTION 'GS_INVALID_ASSIGNMENTS'; END IF;
 -- Acquire profile locks before group locks, matching profile assignment synchronization.
 PERFORM 1 FROM public.profiles p WHERE p.id=ANY(desired) OR EXISTS(SELECT 1 FROM public.grader_assignments a WHERE a.group_id=p_group AND a.grader_id=p.id) ORDER BY p.id FOR UPDATE;
 SELECT * INTO g FROM public.competition_groups WHERE id=p_group FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'GS_SESSION_NOT_FOUND'; END IF;
 SELECT status INTO st FROM public.gs_castings WHERE id=g.casting_id FOR SHARE;
 IF st IN ('published','archived','approved') OR EXISTS(SELECT 1 FROM public.osc_group_publications p WHERE p.group_id=p_group AND p.cancelled_at IS NULL) THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 SELECT coalesce(array_agg(grader_id ORDER BY grader_id),'{}') INTO existing FROM public.grader_assignments WHERE group_id=p_group;
 IF gradesync_internal.group_has_grading_history(p_group)
  OR EXISTS(SELECT 1 FROM public.gs_casting_decisions d JOIN public.candidates c ON c.id=d.candidate_id WHERE c.group_id=p_group)
 THEN RAISE EXCEPTION 'GS_QUORUM_ROSTER_LOCKED'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(desired) x WHERE NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.gs_google_grader_access a ON a.profile_id=p.id WHERE p.id=x AND p.role='Grader' AND p.status='Active' AND a.enabled AND NOT(p.extra_data ? 'oscArchivedAt'))) THEN RAISE EXCEPTION 'GS_GRADER_NOT_FOUND'; END IF;
 FOR entry IN SELECT * FROM jsonb_array_elements(p_judges) LOOP
  IF jsonb_typeof(entry->'criteria')<>'array' THEN RAISE EXCEPTION 'GS_INVALID_CRITERIA'; END IF;
  SELECT coalesce(array_agg(x),'{}') INTO names FROM jsonb_array_elements_text(entry->'criteria') x;
  IF cardinality(names)=0 OR cardinality(names)>20 OR EXISTS(SELECT 1 FROM unnest(names) x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(g.criteria) k WHERE k->>'name'=x)) THEN RAISE EXCEPTION 'GS_INVALID_CRITERIA'; END IF;
 END LOOP;
 -- A scheduled invite must be cancelled with provider before its roster entry can be removed.
 IF EXISTS(SELECT 1 FROM public.osc_session_invite_jobs WHERE group_id=p_group AND NOT(grader_id=ANY(desired)) AND (status='sending' OR (status='accepted' AND send_at>now()))) THEN RAISE EXCEPTION 'GS_INVITE_SCHEDULED'; END IF;
 UPDATE public.osc_session_invite_jobs SET status='cancelled' WHERE group_id=p_group AND NOT(grader_id=ANY(desired)) AND status IN ('pending','failed');
 PERFORM set_config('osc.assignment_scope',p_group::text,true);
 UPDATE public.profiles SET assigned_groups=array_remove(assigned_groups,p_group),updated_at=now() WHERE id=ANY(existing) AND NOT(id=ANY(desired));
 UPDATE public.profiles SET assigned_groups=array_append(coalesce(assigned_groups,'{}'),p_group),updated_at=now() WHERE id=ANY(desired) AND NOT(id=ANY(existing));
 FOR entry IN SELECT * FROM jsonb_array_elements(p_judges) LOOP
  jid:=(entry->>'graderId')::uuid;
  SELECT array_agg(x) INTO names FROM jsonb_array_elements_text(entry->'criteria') x;
  SELECT array_agg(k->>'name') INTO assigned FROM jsonb_array_elements(g.criteria) k;
  IF names @> assigned AND assigned @> names THEN
   DELETE FROM public.gs_criterion_grants WHERE group_id=p_group AND grader_id=jid;
  ELSE
   PERFORM public.osc_set_grader_criteria(jid,p_group,names);
  END IF;
  IF NOT(jid=ANY(existing)) THEN
   SELECT a.email,p.name INTO mail,nm FROM public.gs_google_grader_access a JOIN public.profiles p ON p.id=a.profile_id WHERE a.profile_id=jid;
   INSERT INTO public.osc_session_invite_jobs(group_id,grader_id,email,grader_name,group_name,send_at)
    VALUES(p_group,jid,mail,nm,g.name,greatest(p_send_at,now())) RETURNING id INTO new_job;
   job_ids:=array_append(job_ids,new_job);
  END IF;
 END LOOP;
 PERFORM set_config('osc.assignment_scope','',true);
 INSERT INTO public.audit_logs(group_id,action,details) VALUES(p_group,'osc-session-assignments',jsonb_build_object('actorUid',p_actor,'before',existing,'after',desired,'sendAt',p_send_at));
 RETURN jsonb_build_object('ok',true,'jobIds',job_ids);
END $function$;

CREATE OR REPLACE FUNCTION public.osc_cancel_review(p_casting uuid, p_candidates uuid[], p_actor text)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE st text; r record; n integer:=0;
BEGIN
 IF coalesce(p_actor,'')='' OR cardinality(p_candidates) NOT BETWEEN 1 AND 40 OR array_position(p_candidates,NULL) IS NOT NULL THEN RAISE EXCEPTION 'GS_INVALID_REVIEW'; END IF;
 -- Lock casting before groups and recheck publication in the transaction.
 SELECT status INTO st FROM public.gs_castings WHERE id=p_casting FOR UPDATE;
 IF NOT FOUND OR st IN ('published','archived') THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 PERFORM 1 FROM public.competition_groups g WHERE g.casting_id=p_casting AND EXISTS(SELECT 1 FROM public.candidates c WHERE c.group_id=g.id AND c.id=ANY(p_candidates)) ORDER BY g.id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.candidates c JOIN public.osc_group_publications p ON p.group_id=c.group_id AND p.cancelled_at IS NULL WHERE c.id=ANY(p_candidates)) THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 IF (SELECT count(*) FROM public.gs_casting_decisions WHERE casting_id=p_casting AND candidate_id=ANY(p_candidates) AND review_status='approved' AND synced_at IS NULL)<>cardinality(p_candidates) THEN RAISE EXCEPTION 'GS_REVIEW_NOT_CANCELLABLE'; END IF;
 FOR r IN SELECT d.* FROM public.gs_casting_decisions d WHERE d.casting_id=p_casting AND d.candidate_id=ANY(p_candidates) FOR UPDATE LOOP
  INSERT INTO public.audit_logs(candidate_id,action,details) VALUES(r.candidate_id,'osc-review-cancelled',jsonb_build_object('actorUid',p_actor,'priorDecision',to_jsonb(r)));
  UPDATE public.gs_casting_decisions SET review_status='pending',outcome='pending',score=NULL,reviewed_by=NULL,reviewed_at=NULL,assigned_roles='{}',updated_at=now() WHERE casting_id=p_casting AND candidate_id=r.candidate_id;
  n:=n+1;
 END LOOP;
 UPDATE public.gs_castings SET status='review',updated_at=now() WHERE id=p_casting AND status='approved';
 RETURN n;
END $function$;
