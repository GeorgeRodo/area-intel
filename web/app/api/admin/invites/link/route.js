import { NextResponse } from "next/server";
import {
  requireAdmin, callerClient, audit, errorResponse, findUserByEmail, HttpError,
} from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/invites/link — mint an invitation link without sending mail.
 *
 * generateLink() returns the URL instead of delivering it, which takes the
 * whole mail path out of onboarding: no SMTP, no shared-mailer rate limit, no
 * stuck state when a send fails. The admin passes the link along whatever
 * channel they already use to reach the person. For a pilot onboarding a few
 * named colleagues that is a better fit than a signup funnel, and it stays
 * useful after custom SMTP exists — for the invitee whose mail bounced, or who
 * deleted it.
 *
 * Which link depends on what already exists, because 'invite' only applies to
 * an address with no account:
 *
 *   no account   → invite_user() to allow-list it, then an invite link, which
 *                  creates the passwordless account exactly as the emailed
 *                  flow does.
 *   account, yet → a recovery link. Same destination, and the only kind that
 *   to be used     works once the row exists.
 *
 * The link is a bearer credential for that address: whoever holds it can claim
 * the account. So this refuses to mint one for an account that has already
 * been signed in to.
 *
 * The tempting argument against that guard is that it blocks nothing an admin
 * cannot already do — they can set anyone's password from the sibling route.
 * The difference is not capability, it is noticeability. Setting a password
 * is loud: the holder's own password stops working and they come and ask. A
 * recovery link is silent, so an admin can enter another admin's account, act
 * as them, and leave nothing the victim would ever notice. In a product whose
 * value is that a verified claim carries the name of the person who verified
 * it, a silent way to act under someone else's name is worth closing.
 *
 * Nothing is lost by it. Every case this route exists for — no SMTP, mail
 * bounced, mail deleted, invite expired — is someone who has never got in.
 * For anyone who has, the one honest path left is to set a password from the
 * sibling route and tell them you did. Emailing them a reset link was the
 * better answer and is gone with the rest of the mail paths; bring it back
 * with custom SMTP, not before.
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

    // supabase-js has no lookup-by-email, so the directory is the only way to
    // tell an existing account from a new one — and this route acts on the
    // negative answer, which is what makes the lookup worth doing carefully.
    // "Not in the list" sends it down the invite branch below, so a directory
    // that stopped short would not merely miss someone: it would re-invite a
    // colleague who already has an account. findUserByEmail returns null only
    // after reaching the end of the directory, and raises otherwise.
    const existing = await findUserByEmail(svc, email);

    // See the header comment: a link for a live account is a silent way in.
    if (existing?.last_sign_in_at) {
      throw new HttpError(
        400,
        `${email} has already signed in, so a link would be a way into a live ` +
          `account rather than a way to open a new one. Use "Set password" ` +
          `instead, and tell them the password you chose.`
      );
    }

    const origin = request.headers.get("origin") || new URL(request.url).origin;

    // Not rate limited. This route only ever opens an account that has never
    // been signed in to (guarded above), so it cannot be used to reach a live
    // one, and onboarding is the job — an admin should not be throttled at it.

    if (!existing) {
      // Allow-list first: the invite link creates the account, and
      // handle_new_user() (0005) rejects any address without an unclaimed
      // invite. Called as the admin so the RPC's is_admin() gate, invited_by
      // and audit row all see the real caller.
      const { error: rpcErr } = await callerClient(token).rpc("invite_user", {
        p_email: email,
        p_role: role,
      });
      if (rpcErr) throw new HttpError(400, rpcErr.message);
    }

    const type = existing ? "recovery" : "invite";
    const { data, error } = await svc.auth.admin.generateLink({
      type,
      email,
      options: { redirectTo: `${origin}/signup` },
    });
    if (error) throw new HttpError(502, error.message);

    const link = data?.properties?.action_link;
    if (!link) throw new HttpError(502, "Supabase returned no link.");

    // Stamped only once a URL actually came back, so the timestamp always
    // describes a link that exists. The Users tab reads it to say whether the
    // one you sent is still good; a failure above must not leave a row claiming
    // a live link nobody was ever given. Service key, because there is no
    // client update policy on invited_emails and there should not be.
    const { error: stampErr } = await svc
      .from("invited_emails")
      .update({ link_generated_at: new Date().toISOString() })
      .eq("email", email);
    if (stampErr) {
      // The link is already minted and usable — losing its timestamp only
      // means the row shows as "no link sent yet", which is recoverable by
      // pressing the button again. Not worth failing the request over.
      console.error("[admin] could not stamp link_generated_at:", stampErr.message);
    }

    await audit(svc, caller, {
      action: "generate_invite_link",
      entity_id: existing?.id || email,
      after: { email, role, type },
      note: null,
    });

    return NextResponse.json({
      link,
      email,
      role,
      // Lets the UI say what the recipient will actually see, which differs:
      // an invite sets up a new account, a recovery re-opens an existing one.
      mode: existing ? "recovery" : "invite",
    });
  } catch (e) {
    return errorResponse(e);
  }
}
