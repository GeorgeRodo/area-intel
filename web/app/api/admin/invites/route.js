import { NextResponse } from "next/server";
import { requireAdmin, callerClient, errorResponse, HttpError } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/invites — allow-list an address and email them a link.
 *
 * Two steps that have to happen in this order:
 *
 *   1. invite_user() writes the invited_emails row, carrying the role. Called
 *      as the admin, not as the service role: the function reads auth.uid()
 *      for its is_admin() gate, for invited_by, and for the audit actor.
 *   2. inviteUserByEmail() sends the mail. This is the only way Supabase Auth
 *      will email someone with no account — and it creates that account, empty
 *      of a password, as a side effect. Which is why step 1 must come first:
 *      the account creation fires handle_new_user(), and 0005 makes that
 *      raise unless an unclaimed invite already exists.
 *
 * The consequence to keep in mind: the invitee has an account from the moment
 * you invite them, before they have accepted anything. They show up in the
 * Users tab as `unconfirmed` until they click the link — that flag, not the
 * invite's claimed_at, is what says whether a real person is behind it.
 */
export async function POST(request) {
  try {
    const { svc, token, caller } = await requireAdmin(request);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "user";

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, `${body.email || "That"} is not a valid email address.`);
    }

    // Step 1 — as the caller, so the RPC's own gate and audit trail work.
    const { error: rpcErr } = await callerClient(token).rpc("invite_user", {
      p_email: email,
      p_role: role,
    });
    if (rpcErr) throw new HttpError(400, rpcErr.message);

    // Step 2 — the mail. redirectTo must be on the project's redirect
    // allow-list (Authentication → URL Configuration) or Supabase falls back
    // to the Site URL and the link lands nowhere useful.
    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const { error: mailErr } = await svc.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/signup`,
      data: { invited_by: caller.display_name },
    });

    if (mailErr) {
      // Step 1 already succeeded, so the address is on the allow-list and can
      // still be finished by hand. Say so rather than implying nothing happened.
      throw new HttpError(
        502,
        `${email} is now on the invite list, but the email could not be sent ` +
          `(${mailErr.message}). They can still be added from the Supabase ` +
          `dashboard, or you can send them to /signup directly.`
      );
    }

    return NextResponse.json({ invited: email, role, emailed: true });
  } catch (e) {
    return errorResponse(e);
  }
}
