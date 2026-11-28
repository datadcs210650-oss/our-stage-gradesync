CREATE OR REPLACE FUNCTION gradesync_internal.google_oauth_session()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'auth'
AS $function$
 select coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
 and coalesce((select auth.jwt())->'app_metadata'->'providers','[]'::jsonb) @> '["google"]'::jsonb
 and coalesce((select auth.jwt())->'app_metadata'->'providers','[]'::jsonb) <@ '["email","google"]'::jsonb
 and exists (
   select 1 from auth.users u join auth.identities i on i.user_id=u.id
   where u.id=(select auth.uid()) and u.email_confirmed_at is not null
   and i.provider='google' and i.identity_data->>'email_verified'='true'
   and lower(trim(i.identity_data->>'email'))=lower(trim(u.email))
   and not exists(select 1 from auth.identities x where x.user_id=u.id and x.provider not in ('email','google'))
 )
$function$
;
