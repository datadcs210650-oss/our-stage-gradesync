
CREATE OR REPLACE FUNCTION gradesync_internal.record_score_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $f$
DECLARE old_scores jsonb := '{}'::jsonb; old_note text := ''; new_note text; old_roles jsonb := '[]'::jsonb;
  new_roles jsonb; old_total numeric; changes text; gname text; cname text; jname text; jcode text; event_name text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    old_scores := OLD.scores; old_total := OLD.total_score;
    old_note := coalesce(OLD.extra_data->>'gsJudgeNote','');
    old_roles := coalesce(OLD.extra_data->'gsProposedRoles','[]'::jsonb);
  END IF;
  new_note := coalesce(NEW.extra_data->>'gsJudgeNote','');
  new_roles := coalesce(NEW.extra_data->'gsProposedRoles','[]'::jsonb);
  IF TG_OP='UPDATE' AND (old_scores,old_total,old_note,old_roles) IS NOT DISTINCT FROM
      (NEW.scores,NEW.total_score,new_note,new_roles) THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' AND NEW.scores='{}'::jsonb AND new_note='' AND new_roles='[]'::jsonb THEN RETURN NEW; END IF;
  SELECT string_agg(k||': '||coalesce(old_scores->>k,'—')||' → '||coalesce(NEW.scores->>k,'—'),' · ' ORDER BY k)
    INTO changes FROM (SELECT jsonb_object_keys(old_scores) k UNION SELECT jsonb_object_keys(NEW.scores)) keys
    WHERE old_scores->k IS DISTINCT FROM NEW.scores->k;
  IF old_note IS DISTINCT FROM new_note THEN changes := concat_ws(' · ',changes,'Ghi chú: '||old_note||' → '||new_note); END IF;
  IF old_roles IS DISTINCT FROM new_roles THEN changes := concat_ws(' · ',changes,'Vai đề xuất: '||old_roles::text||' → '||new_roles::text); END IF;
  IF old_total IS DISTINCT FROM NEW.total_score THEN changes := concat_ws(' · ',changes,'Tổng: '||coalesce(old_total::text,'—')||' → '||coalesce(NEW.total_score::text,'—')); END IF;
  SELECT name INTO gname FROM public.competition_groups WHERE id=NEW.group_id;
  SELECT name INTO cname FROM public.candidates WHERE id=NEW.candidate_id AND group_id=NEW.group_id;
  SELECT name,code INTO jname,jcode FROM public.profiles WHERE id=NEW.grader_id;
  event_name := CASE WHEN TG_OP='INSERT' THEN 'score-saved' ELSE 'score-updated' END;
  INSERT INTO public.audit_logs(group_id,grader_id,grader_code,candidate_id,action,created_at,details,extra_data)
  VALUES(NEW.group_id,NEW.grader_id,jcode,NEW.candidate_id,event_name,clock_timestamp(),
   jsonb_build_object('source','score-trigger','revision',NEW.revision,'oldScores',old_scores,'newScores',NEW.scores,'oldTotal',old_total,'newTotal',NEW.total_score,'oldNote',old_note,'newNote',new_note,'oldRoles',old_roles,'newRoles',new_roles),
   jsonb_build_object('candidateName',cname,'graderName',jname,'groupName',gname,'scoreChanged',true,'scoreValue',NEW.total_score,'changeContent',coalesce(changes,'Lưu điểm')));
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION gradesync_internal.record_score_change() FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION gradesync_internal.guard_score_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $f$
BEGIN
 IF TG_OP<>'INSERT' AND OLD.action IN ('score-saved','score-updated') THEN
  RAISE EXCEPTION 'GS_SCORE_AUDIT_IMMUTABLE';
 END IF;
 IF TG_OP<>'DELETE' AND NEW.action IN ('score-saved','score-updated') AND current_user<>'postgres' THEN
  RAISE EXCEPTION 'GS_SCORE_AUDIT_SERVER_ONLY';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION gradesync_internal.guard_score_audit() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER gs_record_score_change AFTER INSERT OR UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION gradesync_internal.record_score_change();
CREATE TRIGGER gs_guard_score_audit BEFORE INSERT OR UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION gradesync_internal.guard_score_audit();
CREATE INDEX IF NOT EXISTS gs_score_audit_group_time_idx ON public.audit_logs(group_id,created_at DESC) WHERE action IN ('score-saved','score-updated');

