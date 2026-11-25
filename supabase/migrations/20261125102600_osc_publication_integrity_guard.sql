-- Final publication is checked again inside the database transaction.
create or replace function gradesync_internal.guard_casting_publication_integrity()
returns trigger language plpgsql security definer set search_path='' as $$
declare g public.competition_groups%rowtype; r record; lim jsonb; role_name text; used integer;
begin
 if new.status<>'published' or old.status='published' then return new;end if;
 for g in select * from public.competition_groups where casting_id=new.id order by id for update loop
  lim:=coalesce(g.extra_data->'gsRoleLimits','{}'::jsonb);
  for r in select c.id,d.review_status,d.outcome,d.assigned_roles from public.candidates c left join public.gs_casting_decisions d on d.candidate_id=c.id and d.casting_id=new.id where c.group_id=g.id loop
   if r.review_status is null or r.review_status='pending' then raise exception 'GS_PUBLICATION_PENDING';end if;
   perform gradesync_internal.assert_candidate_majority(new.id,r.id);
   if r.review_status='approved' and (cardinality(r.assigned_roles)>coalesce((lim->>'maxOfficialRoles')::integer,1) or (cardinality(r.assigned_roles)>0 and r.outcome<>'passed')) then raise exception 'GS_OFFICIAL_ROLE_LIMIT';end if;
  end loop;
  for role_name in select jsonb_array_elements_text(coalesce(g.extra_data->'gsCasting'->'roles','[]'::jsonb)) loop
   select count(*) into used from public.gs_casting_decisions d join public.candidates c on c.id=d.candidate_id where c.group_id=g.id and d.review_status='approved' and d.outcome='passed' and role_name=any(d.assigned_roles);
   if used>coalesce((lim->'capacity'->>role_name)::integer,1) then raise exception 'GS_ROLE_CAPACITY';end if;
  end loop;
 end loop;
 if not exists(select 1 from public.gs_casting_decisions d where d.casting_id=new.id and d.review_status='approved') then raise exception 'GS_PUBLICATION_PENDING';end if;
 return new;
end
$$;
revoke all on function gradesync_internal.guard_casting_publication_integrity() from public,anon,authenticated;
create trigger gs_guard_casting_publication_integrity before update of status on public.gs_castings for each row execute function gradesync_internal.guard_casting_publication_integrity();
notify pgrst,'reload schema';