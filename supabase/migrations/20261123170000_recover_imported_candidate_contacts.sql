-- Older spreadsheet imports kept contact labels inside extra_data.extraData.
with imported as (
 select c.id,g.casting_id,c.code,
 lower(trim(c.extra_data->'extraData'->>'EMAIL')) as email,
 trim(c.extra_data->'extraData'->>'SỐ ĐIỆN THOẠI') as phone,
 count(*) over(partition by g.casting_id,upper(trim(c.code))) as code_count
 from public.candidates c join public.competition_groups g on g.id=c.group_id
)
insert into public.gs_candidate_identity(candidate_id,casting_id,mssv,email,private_fields,email_consent)
select id,casting_id,case when code_count=1 and code ~* '^[a-z]{2}[0-9]{6}$'
 and not exists(select 1 from public.gs_candidate_identity i where i.casting_id=imported.casting_id and i.mssv=upper(imported.code))
 then upper(code) end,
 case when email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' and length(email)<=254 then email end,
 jsonb_strip_nulls(jsonb_build_object('phone',nullif(phone,''))),false
from imported where nullif(email,'') is not null or nullif(phone,'') is not null
on conflict(candidate_id) do nothing;
