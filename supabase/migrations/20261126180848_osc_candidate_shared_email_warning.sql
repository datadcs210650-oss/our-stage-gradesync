create or replace function public.osc_candidate_shared_email_counts(p_group uuid,p_emails text[])
returns table(email text, profile_count bigint) language sql stable security invoker set search_path='' as $$
 select lower(trim(i.email)),count(*) from public.gs_candidate_identity i
 join public.candidates c on c.id=i.candidate_id
 join public.competition_groups g on g.id=c.group_id
 where g.id=p_group and g.osc_deleted_at is null and coalesce(trim(i.email),'')<>''
 and (p_emails is null or lower(trim(i.email))=any(p_emails))
 group by lower(trim(i.email)) having count(*)>1
$$;
revoke all on function public.osc_candidate_shared_email_counts(uuid,text[]) from public,anon,authenticated;
grant execute on function public.osc_candidate_shared_email_counts(uuid,text[]) to service_role;
notify pgrst,'reload schema';