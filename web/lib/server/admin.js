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

/** Write to the same append-only audit_log every other admin action lands in. */
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
  // The action already happened; failing the response now would tell the admin
  // it did not. Surface it in the server log and let the caller succeed.
  if (error) console.error(`[admin] audit write failed for ${action}:`, error.message);
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
