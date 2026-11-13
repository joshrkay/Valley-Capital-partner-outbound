-- Test-only stand-in for the roles a Supabase project already has (anon, authenticated, service_role), so the platform migration can
-- be run against a plain local Postgres. In Supabase these exist; this file is never applied there. service_role bypasses RLS there
-- too. PostgREST sets request.jwt.claims per request; the tests set it by hand.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
-- Supabase's own default privileges: every new table, sequence and function in public is granted to all three API roles. The migration
-- must take back what it does not mean to give; reproducing the defaults here is what lets the tests catch a grant it forgot.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
