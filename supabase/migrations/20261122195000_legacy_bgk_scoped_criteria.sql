-- Legacy code/password BGK may read *only their own* criterion grants while migrating to Google.
-- Service-side score authorization remains the source of truth for both login types.
drop policy if exists "legacy BGK read own criteria" on public.gs_criterion_grants;
create policy "legacy BGK read own criteria"
on public.gs_criterion_grants
for select to authenticated
using (
 grader_id = (select auth.uid()) and
 exists(select 1 from public.profiles p where p.id=grader_id and p.role='Grader' and p.status='Active')
);
