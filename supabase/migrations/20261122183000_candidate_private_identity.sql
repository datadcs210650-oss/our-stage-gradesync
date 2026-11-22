-- Private candidate identities, entirely separate from judge-readable candidates.
create table if not exists public.gs_candidate_identity(
 candidate_id uuid primary key references public.candidates(id) on delete cascade,
 casting_id uuid not null references public.gs_castings(id) on delete cascade,
 mssv text not null check(mssv ~ '^[A-Z0-9_-]{3,50}$'),
 email text check(email is null or (email=lower(trim(email)) and length(email)<=254)),
 email_consent boolean not null default false,
 private_fields jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(),
 unique(casting_id,mssv)
);
create index if not exists gs_candidate_identity_casting_idx on public.gs_candidate_identity(casting_id);
alter table public.gs_candidate_identity enable row level security;
revoke all on public.gs_candidate_identity from public,anon,authenticated;
