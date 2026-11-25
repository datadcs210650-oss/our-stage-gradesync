-- Server-issued PDF ledger. Files contain personal scores and are never client-readable.
create table if not exists public.osc_grading_pdf_issues (
 sha256 text primary key check (sha256 ~ '^[a-f0-9]{64}$'),
 group_id uuid not null references public.competition_groups(id) on delete cascade,
 grader_id uuid,
 kind text not null check (kind in ('individual','aggregate','draft')),
 comparison_code text check (comparison_code ~ '^[0-9]{8}$'),
 receipt_hash text check (receipt_hash ~ '^[a-f0-9]{64}$'),
 receipt_at timestamptz,
 pdf_base64 text not null check (length(pdf_base64) between 100 and 4000000),
 byte_length integer not null check (byte_length between 80 and 2800000),
 actor_uid text not null,
 issued_at timestamptz not null default now(),
 check (kind <> 'individual' or (grader_id is not null and comparison_code is not null and receipt_hash is not null and receipt_at is not null)),
 check (kind <> 'aggregate' or (grader_id is null and comparison_code is null and receipt_hash is null))
);
alter table public.osc_grading_pdf_issues enable row level security;
revoke all on public.osc_grading_pdf_issues from public,anon,authenticated;
grant select,insert on public.osc_grading_pdf_issues to service_role;
create index if not exists osc_grading_pdf_group_idx on public.osc_grading_pdf_issues(group_id);
notify pgrst,'reload schema';