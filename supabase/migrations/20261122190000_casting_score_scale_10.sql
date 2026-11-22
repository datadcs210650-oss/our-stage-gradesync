alter table public.gs_castings alter column pass_score set default 5;
alter table public.gs_castings drop constraint if exists gs_castings_pass_score_check;
alter table public.gs_castings add constraint gs_castings_pass_score_check check(pass_score between 0 and 10);