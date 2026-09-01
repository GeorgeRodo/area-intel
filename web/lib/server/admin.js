import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * Server-only Supabase access for the account-administration routes.
 *
 * Passwords live in auth.users, which no client role can read or write and
 * which only Supabase knows how to hash and to invalidate sessions for. The
 * Auth admin API is the only way in, and it takes the service role key — a key
 * that bypasses RLS entirely. So this module exists under one rule: the key
 * never leaves the server.
 *
 * That is enforced by the variable name. Next.js only inlines env vars
 * prefixed NEXT_PUBLIC_ into the browser bundle; SUPABASE_SERVICE_ROLE_KEY has
 * no such prefix, so importing this file from a component is a build error
 * rather than a silent leak. Nothing here may be imported from client code.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const adminConfigured = Boolean(url && serviceKey);

/**
 * Supabase's own floor is 6. This is deliberately higher: these are staff
 * accounts that can promote claims into the verified layer. Shared by every
 * route that accepts a password so the rule cannot drift between them.
 */
export const MIN_PASSWORD_LENGTH = 10;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Next.js patches global fetch and caches GET requests made in server
 * contexts. supabase-js goes through that same fetch, so an admin listing
 * silently pins itself to whatever the first call returned — new accounts
 * simply never appear, with no error anywhere to explain it. `dynamic =
 * "force-dynamic"` governs the route's own rendering and did not save us here.
 *
 * Opting out at the client covers every call made through it, rather than
 * depending on each route remembering to.
 */
const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: "no-store" });

function serviceClient() {
  // No session persistence: this client is per-request and must never pick up
  // or write a session, or one request's identity could bleed into another's.
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: noStoreFetch },
  });
}

/**
 * Authenticate the caller from the Authorization header and require that they
 * are an admin. Returns the service client plus the verified caller.
 *
 * The role is read server-side from profiles, never taken from the request:
 * a client that could assert its own role would make the whole gate cosmetic.
 */
export async function requireAdmin(request) {
  if (!adminConfigured) {
    throw new HttpError(
      501,
      "Account administration is not configured: SUPABASE_SERVICE_ROLE_KEY is " +
        "missing from the server environment. See web/.env.local."
    );
  }

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) throw new HttpError(401, "Not signed in.");

  const svc = serviceClient();

  // Validates the JWT signature and expiry against the project, so an expired
  // or hand-made token is rejected here rather than trusted downstream.
  const { data, error } = await svc.auth.getUser(token);
  if (error || !data?.user) throw new HttpError(401, "Your session is no longer valid.");

  const { data: profile } = await svc
    .from("profiles")
    .select("role, display_name")
    .eq("id", data.user.id)
    .single();

  if (profile?.role !== "admin") throw new HttpError(403, "Admin role required.");

  return {
    svc,
    token,
    caller: {
      id: data.user.id,
      email: data.user.email,
      display_name: profile.display_name,
    },
  };
}

/**
 * A client that acts *as the caller*, not as the service role.
 *
 * The security-definer RPCs read auth.uid() — for is_admin(), for invited_by,
 * for the audit actor. On a service-role connection that is null, so
 * invite_user() would refuse its own caller. Passing the bearer token through
 * keeps those functions seeing the human who asked, with RLS still applying.
 */
export function callerClient(token) {
  return createClient(
    url,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` }, fetch: noStoreFetch },
    }
  );
}

/**
 * Write to the same append-only audit_log every other admin action lands in.
 *
 * Returns whether the row was written. The action has already happened by the
 * time this runs, so failing the response would tell the admin it did not —
 * but staying silent is wrong too where the audit row is the only surviving
 * record. Deletion is that case: hand the answer back and let the route say so.
 */
export async function audit(svc, caller, { action, entity_id, before = null, after = null, note = null }) {
  const { error } = await svc.rpc("write_audit_as", {
    p_actor: caller.id,
    p_action: action,
    p_entity: "account",
    p_entity_id: entity_id,
    p_before: before,
    p_after: after,
    p_note: note,
  });
  if (error) {
    console.error(`[admin] audit write failed for ${action}:`, error.message);
    return false;
  }
  return true;
}

export function errorResponse(e) {
  const status = e instanceof HttpError ? e.status : 500;
  if (status === 500) console.error("[admin]", e);
  return NextResponse.json(
    { error: status === 500 ? "Something went wrong on the server." : e.message },
    { status }
  );
}

/**
 * Deletion only. Role changes and password resets take an optional note (0009):
 * the account survives those and can be inspected or asked about, and the audit
 * row still records actor, action and time. A deleted account leaves the audit
 * row as the sole surviving record, so there the reason is mandatory.
 */
export function requireNote(note) {
  const trimmed = String(note || "").trim();
  if (!trimmed) throw new HttpError(400, "A reason is required.");
  return trimmed;
}

/**
 * ---------- the account directory ----------
 *
 * Both routes that need to know which accounts exist used to ask for
 * `perPage: 1000` and treat the answer as the whole truth. Two things are
 * wrong with that, and the second is the dangerous one.
 *
 * GoTrue clamps perPage to its own maximum rather than refusing an oversized
 * request, so "1000" was never a guarantee of anything — it was a number that
 * happened to be larger than the team. And the caller cannot detect the clamp
 * by comparing lengths: a full page under a server-side cap looks exactly like
 * a short final page. That is why the loop below stops only on an *empty*
 * page, never on a short one. It costs one extra request and removes the whole
 * class of mistake.
 *
 * The dangerous part was in /invites/link, which reads "not in the list" as
 * "has no account" and moves on to invite them. Truncation there does not
 * degrade the answer, it inverts it: an existing colleague past the cut-off
 * gets treated as a new address. So `findUserByEmail` refuses to conclude
 * "no account" unless it actually reached the end of the directory.
 */
const USER_PAGE_SIZE = 200;

/**
 * A real wall rather than a guess. Past this the Users tab needs paging of its
 * own — it renders every account in one list — so failing loudly is the honest
 * answer, and it is 10,000 accounts away from anything this pilot will see.
 */
const MAX_USER_PAGES = 50;

const STOP = Symbol("stop");

/**
 * Walk the directory a page at a time. Returns true if the end was reached (or
 * `visit` asked to stop early), false if MAX_USER_PAGES ran out first — which
 * is the caller's cue that what it holds is a prefix, not the directory.
 */
async function eachUserPage(svc, visit) {
  for (let page = 1; page <= MAX_USER_PAGES; page++) {
    const { data, error } = await svc.auth.admin.listUsers({
      page,
      perPage: USER_PAGE_SIZE,
    });
    if (error) {
      throw new HttpError(502, `Could not read the account directory: ${error.message}`);
    }

    const batch = data?.users || [];
    // An empty page is the only trustworthy end-of-list signal; see above.
    if (batch.length === 0) return true;
    if (visit(batch) === STOP) return true;
  }
  return false;
}

/** Every account, or an error. Never a silent prefix. */
export async function listAllUsers(svc) {
  const users = [];
  const complete = await eachUserPage(svc, (batch) => {
    users.push(...batch);
  });

  if (!complete) {
    throw new HttpError(
      502,
      `There are more than ${MAX_USER_PAGES * USER_PAGE_SIZE} accounts, which ` +
        `this directory cannot list in one page. Showing a truncated list would ` +
        `hide accounts an admin is looking for, so it is refused instead.`
    );
  }
  return users;
}

/**
 * The one account matching an address, or null — where null means "looked
 * everywhere", not "gave up".
 *
 * supabase-js has no lookup-by-email, so this is a scan. Finding the address
 * ends it immediately; only the negative answer has to see the whole directory,
 * and only the negative answer is acted on destructively.
 */
export async function findUserByEmail(svc, email) {
  const wanted = String(email || "").trim().toLowerCase();
  let match = null;

  const complete = await eachUserPage(svc, (batch) => {
    match = batch.find((u) => u.email?.toLowerCase() === wanted) || null;
    return match ? STOP : undefined;
  });

  if (!match && !complete) {
    throw new HttpError(
      502,
      `Could not confirm whether ${wanted} already has an account: the directory ` +
        `is larger than this lookup can search. Refusing rather than treating ` +
        `them as a new address, which would invite someone who is already here.`
    );
  }
  return match;
}

/**
 * End every session belonging to an account (0014). Returns what was actually
 * removed, or null if the call failed — the caller has usually just changed a
 * password by this point, so this must never throw away the fact that the
 * password change itself succeeded.
 *
 * Note the residual window, which the caller is expected to pass on: this stops
 * the sessions being *renewed*, but an access token already issued is a signed
 * JWT and stays valid until it expires.
 */
export async function revokeSessions(svc, userId) {
  const { data, error } = await svc.rpc("revoke_user_sessions", { p_user_id: userId });
  if (error) {
    console.error(`[admin] session revocation failed for ${userId}:`, error.message);
    return null;
  }
  return {
    sessions: data?.sessions ?? 0,
    refresh_tokens: data?.refresh_tokens ?? 0,
  };
}
