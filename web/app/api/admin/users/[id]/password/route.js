import { NextResponse } from "next/server";
import {
  requireAdmin, audit, errorResponse, revokeSessions,
  MIN_PASSWORD_LENGTH as MIN_LENGTH, HttpError,
} from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/users/[id]/password
 *
 * Replaces the password outright. The admin therefore knows it and has to pass
 * it on, which is the one place in this system where a credential is known to
 * someone other than its owner.
 *
 * There was a second mode that emailed the holder a reset link instead, so
 * nobody but them ever knew it — the better shape, and the one to restore
 * first if custom SMTP ever lands. It is gone because Supabase's built-in
 * mailer only delivers to members of the Supabase organisation and drops
 * everything else after reporting success, so for most of this project's users
 * it was a button that did nothing and said it had worked.
 *
 * For an account that has never been signed in to, the invitation link in the
 * Users tab is still the no-shared-password route. This is for the rest.
 *
 * The password is never logged, never echoed back, and never written to
 * audit_log — only the fact that it was changed, by whom, and why.
 *
 * Replacing the password is half the job. Supabase leaves the account's
 * existing refresh tokens valid, so until 0014 the browser that was already
 * signed in simply renewed itself and carried on — through a reset performed
 * precisely because that browser should no longer have access. revoke_user_
 * sessions() deletes them, and the response says what it removed so the admin
 * is told the truth in either direction. The residual window is real and is
 * reported rather than glossed: an access token already issued is a signed JWT
 * that nothing can withdraw, so it works until it expires (an hour by default).
 * What this ends is the ability to renew past that.
 */
export async function POST(request, { params }) {
  try {
    const { svc, caller } = await requireAdmin(request);
    const targetId = params.id;

    const body = await request.json().catch(() => ({}));
    // Optional here, unlike deletion. The audit row still names the actor, the
    // action and the moment, and the account survives to be asked about — so
    // demanding a sentence before every password reset bought paperwork rather
    // than accountability. Deletion still requires one: nothing else survives it.
    const note = String(body.note || "").trim() || null;

    const password = String(body.password || "");
    if (password.length < MIN_LENGTH) {
      throw new HttpError(400, `Password must be at least ${MIN_LENGTH} characters.`);
    }

    const { data: target, error: lookupErr } = await svc.auth.admin.getUserById(targetId);
    if (lookupErr || !target?.user) throw new HttpError(404, "No such account.");

    const { error } = await svc.auth.admin.updateUserById(targetId, { password });
    if (error) throw new HttpError(502, error.message);

    // Strictly after the password change, never before: revoking first would
    // leave a window in which the old credential still worked and a signed-out
    // session could sign straight back in with it.
    //
    // A failure here returns null rather than throwing. The password has
    // already been replaced by this point, so failing the request would tell
    // the admin nothing happened when something did — the worst of the two
    // wrong answers. The response carries the failure instead, and the Users
    // tab says the sessions are still live.
    const revoked = await revokeSessions(svc, targetId);

    await audit(svc, caller, {
      action: "set_password",
      entity_id: targetId,
      // No before/after for the password itself: there is nothing to record
      // about it that would not be a disclosure. The session count is not the
      // password — and it is the part of this action worth being able to look
      // up later, since "was that account actually closed?" is the question an
      // audit log gets asked after somebody leaves. null means revocation
      // failed, which the log should show as plainly as the response does.
      after: { sessions_revoked: revoked },
      note,
    });

    return NextResponse.json({
      updated: targetId,
      // Both fields, deliberately. `revoked: null` and `{ sessions: 0 }` mean
      // very different things — the call failed, versus the account had no
      // live session to end — and only the first is a problem to report.
      revoked,
      revocation_failed: revoked === null,
      // The caller resetting their own password has also just ended their own
      // other sessions, and this one stops renewing when the token expires.
      // Worth saying out loud rather than letting them discover it.
      self: targetId === caller.id,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
