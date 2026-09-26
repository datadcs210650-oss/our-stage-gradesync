
create extension if not exists pgcrypto;

alter table public.profiles add column if not exists assigned_groups uuid[] not null default '{}';
alter table public.profiles add column if not exists allowed_menus text[] not null default '{}';
alter table public.profiles add column if not exists assigned_group_meta jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists assigned_group_names jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists permissions_version integer not null default 1;
alter table public.profiles add column if not exists permissions_updated_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz default now();
alter table public.profiles add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table public.competition_groups add column if not exists updated_at timestamptz default now();
alter table public.competition_groups add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table public.candidates add column if not exists attendance_order bigint;
alter table public.candidates add column if not exists attendance_updated_at timestamptz;
alter table public.candidates add column if not exists updated_at timestamptz default now();
alter table public.candidates add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table public.scores add column if not exists grader_code text;
alter table public.scores add column if not exists grader_name text;
alter table public.scores add column if not exists submitted_at timestamptz;
alter table public.scores add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table public.grader_verifications add column if not exists grader_code text;
alter table public.grader_verifications add column if not exists grader_name text;
alter table public.grader_verifications add column if not exists updated_at timestamptz default now();
alter table public.grader_verifications add column if not exists extra_data jsonb not null default '{}'::jsonb;
alter table public.audit_logs add column if not exists grader_code text;
alter table public.audit_logs add column if not exists extra_data jsonb not null default '{}'::jsonb;

create table if not exists public.attendance_realtime(id uuid primary key default gen_random_uuid(),group_id uuid unique references public.competition_groups(id) on delete cascade,candidate_id uuid references public.candidates(id) on delete set null,is_present boolean default false,attendance_order bigint default 0,event_id text,updated_at timestamptz default now(),extra_data jsonb not null default '{}'::jsonb);
create table if not exists public.group_publication_index(group_id uuid primary key references public.competition_groups(id) on delete cascade,open_at timestamptz,close_at timestamptz,updated_at timestamptz default now(),extra_data jsonb not null default '{}'::jsonb);
create table if not exists public.grader_sessions(id uuid primary key references auth.users(id) on delete cascade,user_id uuid references public.profiles(id) on delete cascade,auth_uid uuid,grader_code text,assigned_groups uuid[] not null default '{}',online boolean default true,state text default 'active',last_seen timestamptz default now(),updated_at timestamptz default now(),extra_data jsonb not null default '{}'::jsonb);
create table if not exists public.admin_sessions(id uuid primary key references auth.users(id) on delete cascade,profile_id uuid references public.profiles(id) on delete cascade,auth_uid uuid,email text,updated_at timestamptz default now(),extra_data jsonb not null default '{}'::jsonb);
create table if not exists public.submission_notifications(id text primary key,group_id uuid references public.competition_groups(id) on delete cascade,grader_id uuid references public.profiles(id) on delete set null,grader_code text,grader_name text,type text,created_at timestamptz default now(),extra_data jsonb not null default '{}'::jsonb);

alter table public.attendance_realtime enable row level security;
alter table public.group_publication_index enable row level security;
alter table public.grader_sessions enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.submission_notifications enable row level security;

drop policy if exists "admin manage attendance realtime" on public.attendance_realtime;
create policy "admin manage attendance realtime" on public.attendance_realtime for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "grader read attendance realtime" on public.attendance_realtime;
create policy "grader read attendance realtime" on public.attendance_realtime for select to authenticated using(public.is_admin() or public.is_grader_assigned(group_id));
drop policy if exists "admin manage publication index" on public.group_publication_index;
create policy "admin manage publication index" on public.group_publication_index for all to authenticated using(public.is_admin()) with check(public.is_admin());
drop policy if exists "grader read publication index" on public.group_publication_index;
create policy "grader read publication index" on public.group_publication_index for select to authenticated using(public.is_admin() or public.is_grader_assigned(group_id));
drop policy if exists "grader own session" on public.grader_sessions;
create policy "grader own session" on public.grader_sessions for all to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
drop policy if exists "admin own session" on public.admin_sessions;
create policy "admin own session" on public.admin_sessions for all to authenticated using(id=auth.uid() or public.is_admin()) with check(id=auth.uid() or public.is_admin());
drop policy if exists "admin read notifications" on public.submission_notifications;
create policy "admin read notifications" on public.submission_notifications for select to authenticated using(public.is_admin());
drop policy if exists "grader create notification" on public.submission_notifications;
create policy "grader create notification" on public.submission_notifications for insert to authenticated with check(grader_id=auth.uid() and public.is_grader_assigned(group_id));

create or replace function public.sync_profile_assignments_to_rows() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.role='Grader' then
  delete from public.grader_assignments where grader_id=new.id;
  if coalesce(array_length(new.assigned_groups,1),0)>0 then
   insert into public.grader_assignments(grader_id,group_id) select new.id,x from unnest(new.assigned_groups)x on conflict(grader_id,group_id)do nothing;
  end if;
 end if;
 return new;
end;$$;
drop trigger if exists trg_sync_profile_assignments on public.profiles;
create trigger trg_sync_profile_assignments after insert or update of assigned_groups on public.profiles for each row execute function public.sync_profile_assignments_to_rows();

do $$ begin
 begin alter publication supabase_realtime add table public.attendance_realtime; exception when duplicate_object then null; end;
 begin alter publication supabase_realtime add table public.group_publication_index; exception when duplicate_object then null; end;
 begin alter publication supabase_realtime add table public.grader_sessions; exception when duplicate_object then null; end;
 begin alter publication supabase_realtime add table public.submission_notifications; exception when duplicate_object then null; end;
end $$;

grant select,insert,update,delete on public.attendance_realtime,public.group_publication_index,public.grader_sessions,public.admin_sessions,public.submission_notifications to authenticated;
create index if not exists idx_scores_group_grader on public.scores(group_id,grader_id);
create index if not exists idx_scores_grader_code on public.scores(grader_code);
create index if not exists idx_candidates_group on public.candidates(group_id);
create index if not exists idx_verify_group_grader on public.grader_verifications(group_id,grader_id);
