-- Public individual result lookups: server-only rate limiting, no bulk candidate browsing.
create table if not exists public.gs_lookup_rate_limits(
 key_hash text primary key,
 window_start timestamptz not null default now(),
 attempts integer not null default 1
);
alter table public.gs_lookup_rate_limits enable row level security;
revoke all on public.gs_lookup_rate_limits from public,anon,authenticated;
create or replace function public.gs_allow_result_lookup(p_key text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public
as $$
declare count_now int;
begin
 if p_key !~ '^[0-9a-f]{64}$' then return false;end if;
 insert into public.gs_lookup_rate_limits(key_hash,window_start,attempts)
 values(p_key,now(),1)
 on conflict(key_hash) do update set
  attempts=case when gs_lookup_rate_limits.window_start>now()-interval '1 minute'
    then gs_lookup_rate_limits.attempts+1 else 1 end,
  window_start=case when gs_lookup_rate_limits.window_start>now()-interval '1 minute'
    then gs_lookup_rate_limits.window_start else now() end
 returning attempts into count_now;
 return count_now<=30;
end
$$;
revoke all on function public.gs_allow_result_lookup(text) from public,anon,authenticated;
grant execute on function public.gs_allow_result_lookup(text) to service_role;
