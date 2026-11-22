-- FA/SU/SP casting platform, isolated from existing GradeSync score data.
-- All new tables are server-only except scoped judge criterion reads.
create table if not exists public.gs_castings(
 id uuid primary key default gen_random_uuid(),
 term text not null check(term ~ '^(FA|SU|SP)[0-9]{2}$'),
 name text not null check(length(trim(name)) between 2 and 140),
 status text not null default 'draft' check(status in ('draft','grading','review','approved','published','archived')),
 aggregate_method text not null default 'mean' check(aggregate_method in ('mean','weighted','trimmed')),
 grader_weights jsonb not null default '{}'::jsonb,
 pass_score numeric(8,2) not null default 50 check(pass_score between 0 and 100),
 publish_at timestamptz,
 public_fields text[] not null default array['code','name'],
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists gs_castings_term_idx on public.gs_castings(term,created_at desc);
alter table public.competition_groups add column if not exists casting_id uuid references public.gs_castings(id) on delete set null;
create index if not exists gs_competition_casting_idx on public.competition_groups(casting_id);

create table if not exists public.gs_google_grader_access(
 profile_id uuid primary key references public.profiles(id) on delete cascade,
 email text not null unique check(email=lower(trim(email)) and length(email)<=254),
 auth_user_id uuid unique references auth.users(id) on delete set null,
 enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
create index if not exists gs_google_access_auth_idx on public.gs_google_grader_access(auth_user_id) where enabled;
create table if not exists public.gs_criterion_grants(
 grader_id uuid not null references public.profiles(id) on delete cascade,
 group_id uuid not null references public.competition_groups(id) on delete cascade,
 criterion text not null check(length(criterion) between 1 and 100),
 created_at timestamptz not null default now(),
 primary key(grader_id,group_id,criterion)
);
create index if not exists gs_criterion_group_idx on public.gs_criterion_grants(group_id);
create table if not exists public.gs_candidate_fields(
 casting_id uuid not null references public.gs_castings(id) on delete cascade,
 field_key text not null check(field_key ~ '^[a-zA-Z][a-zA-Z0-9_]{0,49}$'),
 label text not null check(length(label) between 1 and 100),
 kind text not null default 'text' check(kind in ('text','number','date','email','select')),
 visibility text not null default 'admin' check(visibility in ('admin','judge','public')),
 required boolean not null default false,
 choices jsonb not null default '[]'::jsonb,
 sort_order integer not null default 0,
 primary key(casting_id,field_key)
);
create table if not exists public.gs_casting_decisions(
 casting_id uuid not null references public.gs_castings(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 outcome text not null check(outcome in ('passed','failed','pending')),
 review_status text not null default 'pending' check(review_status in ('pending','approved','rejected')),
 score numeric(8,2),
 reviewed_by text,
 reviewed_at timestamptz,
 synced_at timestamptz,
 member_id text,
 updated_at timestamptz not null default now(),
 primary key(casting_id,candidate_id)
);
create index if not exists gs_decisions_review_idx on public.gs_casting_decisions(casting_id,review_status);
create table if not exists public.gs_otp_challenges(
 grader_id uuid not null references public.profiles(id) on delete cascade,
 group_id uuid not null references public.competition_groups(id) on delete cascade,
 otp_digest text not null,
 expires_at timestamptz not null,
 sent_at timestamptz not null default now(),
 failed_attempts smallint not null default 0,
 used_at timestamptz,
 primary key(grader_id,group_id)
);
create table if not exists public.gs_grading_receipts(
 grader_id uuid not null references public.profiles(id) on delete cascade,
 group_id uuid not null references public.competition_groups(id) on delete cascade,
 email text not null,
 grader_name text not null,
 verified_at timestamptz not null default now(),
 snapshot jsonb not null,
 snapshot_sha256 text not null,
 confirmation_method text not null default 'email-otp',
 primary key(grader_id,group_id)
);
create table if not exists public.gs_casting_notifications(
 id uuid primary key default gen_random_uuid(),
 casting_id uuid references public.gs_castings(id) on delete cascade,
 event_type text not null check(event_type in ('invite','reminder','submission','publication')),
 recipient_email text not null,
 status text not null default 'queued' check(status in ('queued','sent','failed')),
 attempts smallint not null default 0,
 created_at timestamptz not null default now(),
 sent_at timestamptz,
 last_error text
);
create index if not exists gs_notifications_queue_idx on public.gs_casting_notifications(status,created_at) where status='queued';
create table if not exists public.gs_membership_sync_queue(
 id uuid primary key default gen_random_uuid(),
 casting_id uuid not null references public.gs_castings(id) on delete cascade,
 candidate_id uuid not null references public.candidates(id) on delete cascade,
 term text not null,
 mssv text not null,
 state text not null default 'pending' check(state in ('pending','synced','failed')),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(casting_id,candidate_id)
);
-- No public browsing of admin, OTP, or unpublished candidate data.
alter table public.gs_castings enable row level security;
alter table public.gs_google_grader_access enable row level security;
alter table public.gs_criterion_grants enable row level security;
alter table public.gs_candidate_fields enable row level security;
alter table public.gs_casting_decisions enable row level security;
alter table public.gs_otp_challenges enable row level security;
alter table public.gs_grading_receipts enable row level security;
alter table public.gs_casting_notifications enable row level security;
alter table public.gs_membership_sync_queue enable row level security;
revoke all on public.gs_otp_challenges,public.gs_grading_receipts,public.gs_membership_sync_queue,public.gs_casting_notifications from anon, authenticated;
-- Google access is only claimed through verified OAuth identity and invited email.
create or replace function public.gs_current_grader_id() returns uuid
language sql stable security definer set search_path=pg_catalog,public,auth
as $$
 select a.profile_id from public.gs_google_grader_access a
 join public.profiles p on p.id=a.profile_id
 where a.auth_user_id=(select auth.uid()) and a.enabled=true
   and p.role='Grader' and p.status='Active'
 limit 1
$$;
revoke all on function public.gs_current_grader_id() from public,anon;
grant execute on function public.gs_current_grader_id() to authenticated;
create or replace function public.gs_claim_google_grader() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,auth
as $$
declare v_uid uuid:=auth.uid();v_email text;v_auth uuid;v_p public.profiles%rowtype;
begin
 if v_uid is null then raise exception 'AUTH_REQUIRED';end if;
 select lower(trim(u.email)),u.id into v_email,v_auth
 from auth.users u where u.id=v_uid and u.email_confirmed_at is not null
 and exists(select 1 from auth.identities i where i.user_id=v_uid and i.provider='google');
 if v_email is null then raise exception 'GOOGLE_VERIFICATION_REQUIRED'; end if;
 select p.* into v_p from public.gs_google_grader_access a
 join public.profiles p on p.id=a.profile_id
 where a.email=v_email and a.enabled=true and p.role='Grader' and p.status='Active'
   and (a.auth_user_id is null or a.auth_user_id=v_uid) for update of p;
 if not found then raise exception 'GOOGLE_EMAIL_NOT_INVITED'; end if;
 update public.gs_google_grader_access set auth_user_id=v_uid,updated_at=now()
 where profile_id=v_p.id and (auth_user_id is null or auth_user_id=v_uid);
 if not found then raise exception 'GOOGLE_ACCOUNT_ALREADY_LINKED'; end if;
 return jsonb_build_object('id',v_p.id,'code',v_p.code,'name',v_p.name,'email',v_email,
   'role','Grader','status',v_p.status,'assignedGroups',v_p.assigned_groups,
   'allowedMenus',v_p.allowed_menus);
end;
$$;
revoke all on function public.gs_claim_google_grader() from public,anon;
grant execute on function public.gs_claim_google_grader() to authenticated;
-- Additive policies: existing legacy sessions retain access during staged OAuth cutover.
create policy "google assigned profiles" on public.profiles for select to authenticated
using(id=(select public.gs_current_grader_id()));
create policy "google own assignments" on public.grader_assignments for select to authenticated
using(grader_id=(select public.gs_current_grader_id()));
create policy "google assigned groups" on public.competition_groups for select to authenticated
using(exists(select 1 from public.grader_assignments a where a.grader_id=(select public.gs_current_grader_id()) and a.group_id=id));
create policy "google assigned candidates" on public.candidates for select to authenticated
using(exists(select 1 from public.grader_assignments a where a.grader_id=(select public.gs_current_grader_id()) and a.group_id=candidates.group_id));
create policy "google own scores" on public.scores for select to authenticated
using(grader_id=(select public.gs_current_grader_id()));
create policy "google own insert scores" on public.scores for insert to authenticated
with check(grader_id=(select public.gs_current_grader_id()) and exists(select 1 from public.grader_assignments a where a.grader_id=scores.grader_id and a.group_id=scores.group_id));
create policy "google own unlocked scores" on public.scores for update to authenticated
using(grader_id=(select public.gs_current_grader_id()) and locked=false)
with check(grader_id=(select public.gs_current_grader_id()));
create policy "google own read verification" on public.grader_verifications for select to authenticated
using(grader_id=(select public.gs_current_grader_id()));
create policy "google own insert verification" on public.grader_verifications for insert to authenticated
with check(grader_id=(select public.gs_current_grader_id()));
create policy "google own update verification" on public.grader_verifications for update to authenticated
using(grader_id=(select public.gs_current_grader_id()))
with check(grader_id=(select public.gs_current_grader_id()));
create policy "google own criteria" on public.gs_criterion_grants for select to authenticated
using(grader_id=(select public.gs_current_grader_id()));
-- Note: all casts, results, OTP and sync writes are performed through an OSC manager-authorized service.
