-- tests/pg_harness.sql
-- Stubs the Supabase runtime locally so migrations + RLS can be tested on
-- plain Postgres: auth schema, auth.users, auth.uid(), anon/authenticated roles.
-- Run BEFORE the migrations on a scratch database. Never run on Supabase.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb
);

-- Supabase resolves auth.uid() from the request JWT; locally we read a GUC.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
end $$;
