import { NextResponse } from "next/server";
import {
  requireAdmin, audit, errorResponse,
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

    await audit(svc, caller, {
      action: "set_password",
      entity_id: targetId,
      // Deliberately no before/after: there is nothing to record about a
      // password that would not itself be a disclosure.
      note,
    });

    return NextResponse.json({ updated: targetId });
  } catch (e) {
    return errorResponse(e);
  }
}
