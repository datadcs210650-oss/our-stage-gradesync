
CREATE OR REPLACE FUNCTION gradesync_internal.guard_score_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $f$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.action IN ('score-saved','score-updated') THEN
   -- FK ON DELETE SET NULL may detach an archived audit record from its deleted parent.
   -- Its server snapshots and all other values stay immutable.
   IF TG_OP='UPDATE' AND pg_trigger_depth()>1
      AND (to_jsonb(OLD)-ARRAY['group_id','grader_id','candidate_id'])=(to_jsonb(NEW)-ARRAY['group_id','grader_id','candidate_id'])
      AND (NEW.group_id IS NOT DISTINCT FROM OLD.group_id OR (NEW.group_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.competition_groups WHERE id=OLD.group_id)))
      AND (NEW.grader_id IS NOT DISTINCT FROM OLD.grader_id OR (NEW.grader_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=OLD.grader_id)))
      AND (NEW.candidate_id IS NOT DISTINCT FROM OLD.candidate_id OR (NEW.candidate_id IS NULL AND NOT EXISTS(SELECT 1 FROM public.candidates WHERE id=OLD.candidate_id)))
   THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'GS_SCORE_AUDIT_IMMUTABLE';
 END IF;
 IF TG_OP<>'DELETE' AND NEW.action IN ('score-saved','score-updated') AND current_user<>'postgres' THEN
  RAISE EXCEPTION 'GS_SCORE_AUDIT_SERVER_ONLY';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $f$;
CREATE OR REPLACE FUNCTION public.osc_session_review_summary()
RETURNS TABLE(group_id uuid, eligible_count bigint, approved_count bigint)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $f$
 SELECT g.id,
 count(c.id) FILTER (WHERE coalesce(g.extra_data->'attendanceEnabled'='true'::jsonb,false)=false OR c.is_present=true),
 count(c.id) FILTER (WHERE (coalesce(g.extra_data->'attendanceEnabled'='true'::jsonb,false)=false OR c.is_present=true)
   AND d.review_status='approved' AND d.score BETWEEN 0 AND 10 AND d.outcome IN ('passed','failed') AND d.reviewed_at IS NOT NULL)
 FROM public.competition_groups g LEFT JOIN public.candidates c ON c.group_id=g.id
 LEFT JOIN public.gs_casting_decisions d ON d.candidate_id=c.id AND d.casting_id=g.casting_id
 GROUP BY g.id;
$f$;
REVOKE ALL ON FUNCTION public.osc_session_review_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.osc_session_review_summary() TO service_role;

