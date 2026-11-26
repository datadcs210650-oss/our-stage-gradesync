
CREATE OR REPLACE FUNCTION public.osc_grader_session_access(p_group uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $f$
 SELECT EXISTS (
  SELECT 1 FROM public.grader_assignments a JOIN public.competition_groups g ON g.id=a.group_id
  LEFT JOIN public.gs_castings c ON c.id=g.casting_id
  WHERE a.group_id=p_group AND a.grader_id=public.gs_current_grader_id()
  AND NOT(coalesce(c.status IN ('published','archived'),false)
      AND coalesce(g.extra_data->'blockGraderAfterPublish'='true'::jsonb,true))
 )
$f$;
REVOKE ALL ON FUNCTION public.osc_grader_session_access(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.osc_grader_session_access(uuid) TO authenticated,service_role;
DO $f$ DECLARE t text; col text; BEGIN
 FOREACH t IN ARRAY ARRAY['competition_groups','candidates','scores','grader_verifications','grader_assignments','gs_criterion_grants','group_publication_index','attendance_realtime','attendance','submission_notifications'] LOOP
  col:=CASE WHEN t='competition_groups' THEN 'id' ELSE 'group_id' END;
  IF EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) THEN
   EXECUTE format('DROP POLICY IF EXISTS osc_published_session_guard ON public.%I',t);
   EXECUTE format('CREATE POLICY osc_published_session_guard ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (public.osc_grader_session_access(%I)) WITH CHECK (public.osc_grader_session_access(%I))',t,col,col);
  END IF;
 END LOOP;
END $f$;
CREATE TABLE public.osc_session_invite_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 group_id uuid NOT NULL REFERENCES public.competition_groups(id) ON DELETE CASCADE,
 grader_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 email text NOT NULL, grader_name text NOT NULL, group_name text NOT NULL,
 send_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','accepted','failed','cancelled')),
 provider_id text, lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(), last_error text
);
ALTER TABLE public.osc_session_invite_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.osc_session_invite_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.osc_session_invite_jobs TO service_role;
CREATE INDEX osc_invite_pending ON public.osc_session_invite_jobs(group_id,status,created_at);
CREATE OR REPLACE FUNCTION public.osc_save_session_assignments(p_group uuid,p_judges jsonb,p_send_at timestamptz,p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
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
 IF st IN ('published','archived','approved') THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
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
END $f$;
REVOKE ALL ON FUNCTION public.osc_save_session_assignments(uuid,jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.osc_save_session_assignments(uuid,jsonb,timestamptz,text) TO service_role;
CREATE OR REPLACE FUNCTION gradesync_internal.guard_grader_assignment_scope()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE delta uuid[]; gid uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.role='Grader' AND cardinality(coalesce(NEW.assigned_groups,'{}'))>0 THEN RAISE EXCEPTION 'GS_ASSIGN_IN_SESSION_ONLY'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.role<>'Grader' OR NEW.assigned_groups IS NOT DISTINCT FROM OLD.assigned_groups THEN RETURN NEW; END IF;
 SELECT array_agg(x) INTO delta FROM ((SELECT unnest(coalesce(NEW.assigned_groups,'{}')) x EXCEPT SELECT unnest(coalesce(OLD.assigned_groups,'{}'))) UNION ALL (SELECT unnest(coalesce(OLD.assigned_groups,'{}')) EXCEPT SELECT unnest(coalesce(NEW.assigned_groups,'{}')))) s;
 -- Preserve the existing super-admin delete-session path (the group has already been deleted).
 FOREACH gid IN ARRAY coalesce(delta,'{}') LOOP
  IF EXISTS(SELECT 1 FROM public.competition_groups WHERE id=gid) AND current_setting('osc.assignment_scope',true) IS DISTINCT FROM gid::text THEN RAISE EXCEPTION 'GS_ASSIGN_IN_SESSION_ONLY'; END IF;
 END LOOP;
 -- Also block additions even if the EXCEPT set above omitted them.
 FOREACH gid IN ARRAY coalesce(NEW.assigned_groups,'{}') LOOP
  IF NOT(gid=ANY(coalesce(OLD.assigned_groups,'{}'))) AND current_setting('osc.assignment_scope',true) IS DISTINCT FROM gid::text THEN RAISE EXCEPTION 'GS_ASSIGN_IN_SESSION_ONLY'; END IF;
 END LOOP;
 RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION gradesync_internal.guard_grader_assignment_scope() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER osc_grader_assignment_scope BEFORE INSERT OR UPDATE OF assigned_groups ON public.profiles FOR EACH ROW EXECUTE FUNCTION gradesync_internal.guard_grader_assignment_scope();
CREATE OR REPLACE FUNCTION public.osc_cancel_review(p_casting uuid,p_candidates uuid[],p_actor text)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path=''
AS $f$
DECLARE st text; r record; n integer:=0;
BEGIN
 IF coalesce(p_actor,'')='' OR cardinality(p_candidates) NOT BETWEEN 1 AND 40 OR array_position(p_candidates,NULL) IS NOT NULL THEN RAISE EXCEPTION 'GS_INVALID_REVIEW'; END IF;
 -- Lock casting before groups and recheck publication in the transaction.
 SELECT status INTO st FROM public.gs_castings WHERE id=p_casting FOR UPDATE;
 IF NOT FOUND OR st IN ('published','archived') THEN RAISE EXCEPTION 'GS_SESSION_FINAL'; END IF;
 PERFORM 1 FROM public.competition_groups g WHERE g.casting_id=p_casting AND EXISTS(SELECT 1 FROM public.candidates c WHERE c.group_id=g.id AND c.id=ANY(p_candidates)) ORDER BY g.id FOR UPDATE;
 IF (SELECT count(*) FROM public.gs_casting_decisions WHERE casting_id=p_casting AND candidate_id=ANY(p_candidates) AND review_status='approved' AND synced_at IS NULL)<>cardinality(p_candidates) THEN RAISE EXCEPTION 'GS_REVIEW_NOT_CANCELLABLE'; END IF;
 FOR r IN SELECT d.* FROM public.gs_casting_decisions d WHERE d.casting_id=p_casting AND d.candidate_id=ANY(p_candidates) FOR UPDATE LOOP
  INSERT INTO public.audit_logs(candidate_id,action,details) VALUES(r.candidate_id,'osc-review-cancelled',jsonb_build_object('actorUid',p_actor,'priorDecision',to_jsonb(r)));
  UPDATE public.gs_casting_decisions SET review_status='pending',outcome='pending',score=NULL,reviewed_by=NULL,reviewed_at=NULL,assigned_roles='{}',updated_at=now() WHERE casting_id=p_casting AND candidate_id=r.candidate_id;
  n:=n+1;
 END LOOP;
 UPDATE public.gs_castings SET status='review',updated_at=now() WHERE id=p_casting AND status='approved';
 RETURN n;
END $f$;
REVOKE ALL ON FUNCTION public.osc_cancel_review(uuid,uuid[],text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.osc_cancel_review(uuid,uuid[],text) TO service_role;

