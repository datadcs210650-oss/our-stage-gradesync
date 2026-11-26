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
 IF st IN ('published','archived') THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
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
END $function$

