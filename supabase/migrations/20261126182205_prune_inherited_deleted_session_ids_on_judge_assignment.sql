CREATE OR REPLACE FUNCTION gradesync_internal.guard_grader_assignment_scope()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE delta uuid[]; gid uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.role='Grader' AND cardinality(coalesce(NEW.assigned_groups,'{}'))>0 THEN RAISE EXCEPTION 'GS_ASSIGN_IN_SESSION_ONLY'; END IF;
  RETURN NEW;
 END IF;
 IF OLD.role<>'Grader' THEN RETURN NEW; END IF;
 -- A deleted session can survive in the legacy array after its assignment rows cascade.
 -- Drop only inherited missing IDs. New IDs still go through the original scope checks.
 IF NEW.assigned_groups IS NOT NULL THEN
  NEW.assigned_groups := ARRAY(
   SELECT entry.gid FROM unnest(NEW.assigned_groups) WITH ORDINALITY AS entry(gid,pos)
   WHERE NOT EXISTS (SELECT 1 FROM unnest(OLD.assigned_groups) AS prior(id) WHERE prior.id=entry.gid)
      OR EXISTS (SELECT 1 FROM public.competition_groups g WHERE g.id=entry.gid)
   ORDER BY entry.pos
  );
 END IF;
 IF NEW.assigned_groups IS NOT DISTINCT FROM OLD.assigned_groups THEN RETURN NEW; END IF;
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
END $function$
