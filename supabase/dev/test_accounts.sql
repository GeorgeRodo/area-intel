-- test_accounts.sql — DEVELOPMENT ONLY. NOT A MIGRATION.
--
-- Deliberately not numbered into supabase/migrations/: those run in order on
-- every environment, and this one creates accounts with passwords written in
-- plain text in a file that is committed to the repo. Running it against
-- anything a client can reach would be handing out keys.
--
-- Creates two accounts that can actually sign in:
--
--   test.user@areaintel.pt   / TestUser2026!    role: user
--   test.admin@areaintel.pt  / TestAdmin2026!   role: admin
--
-- Run it in the Supabase SQL editor, which connects as postgres. Nothing less
-- privileged can write to the auth schema.
--
-- Re-runnable: it deletes any previous version of these two accounts first.
--
-- Three things this has to get right, each of which fails silently or
-- confusingly if skipped:
--
--   1. The invited_emails row must exist and be unclaimed BEFORE the account
--      is created. handle_new_user() (0005) raises otherwise and takes the
--      auth.users insert down with it — the error surfaces as the unhelpful
--      "Database error saving new user". The invite also carries the role, so
--      that trigger is what makes one of these an admin.
--
--   2. auth.identities needs a matching row. GoTrue looks up a password login
--      through the identity, not through auth.users, so an account with no
--      identity row exists, appears in the dashboard, and cannot sign in.
--
--   3. The token columns are set to '' rather than left NULL. Some GoTrue
--      versions scan them into non-nullable strings and fail the login with
--      "converting NULL to string is unsupported".

-- pgcrypto lives in the extensions schema on Supabase; crypt()/gen_salt() are
-- unqualified below, so put it on the path rather than guessing its location.
set search_path = public, extensions;

do $$
declare
  r  record;
  v_id uuid;
begin
  for r in
    select *
      from (values
        ('test.user@areaintel.pt',  'TestUser2026!',  'user',  'Test User'),
        ('test.admin@areaintel.pt', 'TestAdmin2026!', 'admin', 'Test Admin')
      ) as t(email, password, role, display_name)
  loop
    -- Clear any earlier run. profiles and auth.identities both cascade from
    -- auth.users, so this is enough to make the script idempotent.
    delete from auth.users            where lower(email) = lower(r.email);
    delete from public.invited_emails where lower(email) = lower(r.email);

    insert into public.invited_emails (email, role)
    values (lower(r.email), r.role);

    v_id := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      v_id,
      'authenticated',
      'authenticated',
      lower(r.email),
      crypt(r.password, gen_salt('bf')),
      now(),            -- pre-confirmed: no email is ever sent for these
      now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', r.display_name),
      '', '', '', ''
    );

    insert into auth.identities (
      provider_id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) values (
      v_id::text,
      v_id,
      jsonb_build_object(
        'sub', v_id::text,
        'email', lower(r.email),
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(), now(), now()
    );

    raise notice 'created % (%)', r.email, r.role;
  end loop;
end $$;

-- Confirm the trigger did its half: a profile with the role the invite carried,
-- and an identity without which the password would never be checked.
select u.email,
       p.role,
       p.display_name,
       u.email_confirmed_at is not null as confirmed,
       exists (select 1 from auth.identities i where i.user_id = u.id) as can_sign_in
  from auth.users u
  left join public.profiles p on p.id = u.id
 where u.email in ('test.user@areaintel.pt', 'test.admin@areaintel.pt')
 order by p.role;
