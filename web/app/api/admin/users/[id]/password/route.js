import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireAdmin, audit, errorResponse, HttpError } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

// Supabase's own floor is 6. This is deliberately higher: these are staff
// accounts that can promote claims into the verified layer.
const MIN_LENGTH = 10;

/**
 * POST /api/admin/users/[id]/password
 *
 * Two modes, because there are only two honest things an admin can do to a
 * password they cannot read:
 *
 *   { mode: "set", password, note }  — replace it outright. The admin knows
 *       the new value and has to pass it to the person out of band.
 *   { mode: "recovery", note }       — email the person a reset link and stay
 *       out of it. Preferable: nobody but the account holder ever knows the
 *       password, which is the property that makes an audit trail mean
 *       something.
 *
 * The password is never logged, never echoed back, and never written to
 * audit_log — only the fact that it was changed, by whom, and why.
 */
export async function POST(request, { params }) {
  try {
    const { svc, caller } = await requireAdmin(request);
    const targetId = params.id;

    const body = await request.json().catch(() => ({}));
    const mode = body.mode === "recovery" ? "recovery" : "set";
    // Optional here, unlike deletion. The audit row still names the actor, the
    // action and the moment, and the account survives to be asked about — so
    // demanding a sentence before every password reset bought paperwork rather
    // than accountability. Deletion still requires one: nothing else survives it.
    const note = String(body.note || "").trim() || null;

    const { data: target, error: lookupErr } = await svc.auth.admin.getUserById(targetId);
    if (lookupErr || !target?.user) throw new HttpError(404, "No such account.");

    if (mode === "recovery") {
      if (!target.user.email) throw new HttpError(400, "That account has no email address.");

      // resetPasswordForEmail is an anon-key call by design — it is the same
      // path as the "forgot password" link, so the link that lands in the
      // inbox is one only the recipient can use. Generating it with the
      // service key instead would hand the admin a working takeover link.
      const anon = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      );
      const origin = request.headers.get("origin") || new URL(request.url).origin;
      const { error } = await anon.auth.resetPasswordForEmail(target.user.email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) throw new HttpError(502, `Supabase refused to send the email: ${error.message}`);

      await audit(svc, caller, {
        action: "send_password_recovery",
        entity_id: targetId,
        after: { email: target.user.email },
        note,
      });

      return NextResponse.json({ sent_to: target.user.email });
    }

    const password = String(body.password || "");
    if (password.length < MIN_LENGTH) {
      throw new HttpError(400, `Password must be at least ${MIN_LENGTH} characters.`);
    }

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
