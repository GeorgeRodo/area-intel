-- 0014 — make "set a password" actually close the account.
--
-- TASKS.md #3 carried this as an open hole, and it is the kind worth naming
-- precisely. `auth.admin.updateUserById({ password })` replaces the credential
-- and nothing else: every refresh token already issued to that account stays
-- valid, so the browser that was signed in before the reset renews itself and
-- carries on indefinitely. The two cases the feature exists for — somebody has
-- left, or an account is compromised — are exactly the cases where the person
-- holding the old session is the person you are trying to remove. Changing the
-- password they no longer need to type was never going to stop them.
--
-- supabase-js exposes no admin session revocation. `auth.admin.signOut(jwt)`
-- takes the *holder's* access token, which an admin does not have and cannot
-- get, so it addresses a different problem. GoTrue's own /logout is likewise
-- scoped to the caller. That leaves deleting the rows, which means this
-- function reaches into the auth schema.
--
-- THE ASSUMPTION BEING PINNED. This is the only object in the project that
-- depends on GoTrue's internal table layout, so it is spelled out rather than
-- discovered later:
--
--   * auth.sessions (user_id uuid) — one row per active sign-in. Deleting it
--     cascades to auth.refresh_tokens and auth.mfa_amr_claims, both of which
--     declare `on delete cascade` against it.
--   * auth.refresh_tokens (user_id varchar) — deleted explicitly as well,
--     because the column is text rather than uuid, and because tokens issued
--     by older GoTrue versions can carry a null session_id and therefore hang
--     off no session row to cascade from. The cast below compares as text so
--     it is right either way.
--
-- If a future GoTrue drops auth.sessions, this raises rather than returning
-- zero. A revocation that quietly revoked nothing is the failure mode the
-- email paths were deleted for; it must not be reintroduced here.
--
-- WHAT THIS DOES NOT DO, and the route says so to the admin. The access token
-- is a signed JWT: nothing in the database can withdraw one, so a token already
-- in a browser keeps working until it expires (Authentication → Sessions, one
-- hour by default). Deleting the rows below means it cannot be renewed, so the
-- session ends at the next refresh instead of never. Closing the residual
-- window entirely would mean rotating the project's JWT secret, which signs
-- every other user out too. That trade is not ours to make silently.

create or replace function public.revoke_user_sessions(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_sessions int := 0;
  v_tokens   int := 0;
begin
  -- Late-bound on purpose: plpgsql does not resolve these until the function
  -- runs, so the guard gets to produce a legible error instead of a 42P01 from
  -- somewhere inside a password reset.
  if to_regclass('auth.sessions') is null then
    raise exception 'auth.sessions does not exist: GoTrue''s schema has changed, and session revocation must be rewritten before it can be trusted';
  end if;

  delete from auth.sessions where user_id = p_user_id;
  get diagnostics v_sessions = row_count;

  if to_regclass('auth.refresh_tokens') is not null then
    -- user_id is varchar here and uuid there; compare as text so neither a
    -- schema change nor the current mismatch turns into a silent zero.
    delete from auth.refresh_tokens where user_id::text = p_user_id::text;
    get diagnostics v_tokens = row_count;
  end if;

  return jsonb_build_object('sessions', v_sessions, 'refresh_tokens', v_tokens);
end $$;

-- ---------- grants ----------
--
-- service_role only, which is a departure from set_user_role/invite_user and
-- deliberate. Those are gated by is_admin() and called from the browser as the
-- admin. This one cannot be: it is invoked from the password route on a
-- service-key connection, where auth.uid() is null and is_admin() would refuse
-- its own caller — the same reason write_audit_as() (0008) is service_role too.
--
-- So the access control is requireAdmin() in web/lib/server/admin.js, exactly
-- as it is for setting the password this accompanies. Nothing is widened by
-- that: an admin who can reach this route can already replace the credential
-- outright. Handing a client role the ability to delete arbitrary sessions
-- would be the wider surface, and it buys nothing.
revoke execute on function public.revoke_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;

-- ---------- if this raises 'permission denied for table sessions' ----------
--
-- A security definer function runs as its owner, and the owner here is whoever
-- applies this migration — `postgres` from the SQL editor. The auth schema
-- belongs to supabase_auth_admin, and postgres reaches it by grant rather than
-- by ownership, which has been true for every Supabase project this was written
-- against but is not a promise. If that grant is ever absent the fix is one
-- line, run as a role that can:
--
--   alter function public.revoke_user_sessions(uuid) owner to supabase_auth_admin;
--
-- Do not "fix" it by dropping the revocation call from the password route. A
-- reset that leaves the old sessions running is the bug this migration exists
-- for, and the route is already written to report the failure rather than hide
-- it — an admin told "sessions could NOT be ended" can act; one told nothing
-- believes a departed colleague has been locked out when they have not.

-- PostgREST caches the schema, and the route reaches this over rpc. Supabase's
-- DDL event trigger normally reloads on its own; saying so explicitly costs
-- nothing and saves a confusing 404 on the first call after a manual apply.
notify pgrst, 'reload schema';
