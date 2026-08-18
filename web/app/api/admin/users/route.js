import { NextResponse } from "next/server";
import {
  requireAdmin, callerClient, audit, errorResponse,
  MIN_PASSWORD_LENGTH, HttpError,
} from "@/lib/server/admin";

// Reads the caller's bearer token, so it can never be prerendered or cached.
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users — the account directory.
 *
 * profiles holds the role and display name; the email address and sign-in
 * history live in auth.users, which is invisible to every client role. Joining
 * them needs the service key, which is why the Users tab showed bare uuids
 * before this route existed.
 */
export async function GET(request) {
  try {
    const { svc } = await requireAdmin(request);

    const [{ data: list, error: authErr }, { data: profiles, error: profErr }] =
      await Promise.all([
        svc.auth.admin.listUsers({ page: 1, perPage: 1000 }),
        svc.from("profiles").select("id, role, display_name"),
      ]);

    if (authErr) throw new Error(authErr.message);
    if (profErr) throw new Error(profErr.message);

    const byId = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

    const users = (list?.users || []).map((u) => ({
      id: u.id,
      email: u.email,
      // An account with no profile row should not exist — handle_new_user
      // creates one in the same transaction as the signup — but if it ever
      // does, showing it as an unknown role is more useful than hiding it.
      role: byId[u.id]?.role ?? null,
      display_name: byId[u.id]?.display_name ?? u.email?.split("@")[0] ?? "—",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      confirmed: Boolean(u.email_confirmed_at || u.confirmed_at),
    }));

    users.sort((a, b) => (a.email || "").localeCompare(b.email || ""));

    return NextResponse.json(users);
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/admin/users — create an account outright, with no email involved.
 *
 * The interim answer to the mailer being unusable (see /api/admin/invites).
 * The alternative is an invitation link, which the person opens to set their
 * own password. Prefer that where you can. This exists for the case where
 * handing someone a working login outright is simply less friction than
 * getting a link to them and waiting for them to use it.
 *
 * Same two steps as the invitation link, in the same order and for the same
 * reason — there is no way to create an account that skips the allow-list:
 *
 *   1. invite_user() writes the invited_emails row, as the caller so the RPC's
 *      is_admin() gate, invited_by and audit row see the human who asked.
 *   2. createUser() makes the account. handle_new_user() (0005) fires and
 *      raises unless step 1 has already run, and it reads the role off that
 *      invite row — so step 1 is also what decides whether this is an admin.
 *
 * email_confirm is set because nobody is going to click a confirmation link
 * that was never sent: without it the account exists but cannot be signed in
 * to, and Supabase tries to mail one, which is the thing being avoided.
 *
 * The cost, and it is a real one: the admin chooses the password, so for the
 * first time in this system a credential is known to someone other than its
 * owner. Every other path here was built to avoid exactly that. It is
 * defensible only because it is temporary and because the alternative right
 * now is an invitation that silently never arrives — but it means the account
 * holder should change it, and it is why this should go once SMTP exists.
 */
export async function POST(request) {
  try {
    const { svc, token, caller } = await requireAdmin(request);

    const body = await request.json().catch(() => ({}));
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role === "admin" ? "admin" : "user";
    const password = String(body.password || "");
    const displayName = String(body.display_name || "").trim();

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new HttpError(400, `${body.email || "That"} is not a valid email address.`);
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new HttpError(
        400,
        `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
      );
    }

    // Deliberately not rate limited. Onboarding is the job, and an account
    // created in error is visible in the Users tab and deletable in one click.

    // Step 1. Refuses an address that has already signed up, which is the
    // check that stops this route quietly re-creating an existing colleague.
    const { error: rpcErr } = await callerClient(token).rpc("invite_user", {
      p_email: email,
      p_role: role,
    });
    if (rpcErr) throw new HttpError(400, rpcErr.message);

    // Step 2.
    const { data: created, error: createErr } = await svc.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: displayName ? { name: displayName } : undefined,
    });

    if (createErr) {
      // Deliberately not rolled back, on the same reasoning as /invites: the
      // allow-list entry is a true record either way, retrying is safe because
      // the invite is still unclaimed, and an unclaimed row shows up in the
      // Invitations list as pending with a working Revoke next to it. Undoing
      // it here would only be guesswork about which of those the admin wanted.
      throw new HttpError(
        502,
        `${email} is on the invite list, but the account could not be created ` +
          `(${createErr.message}). Try again, or revoke the invitation below.`
      );
    }

    await audit(svc, caller, {
      action: "create_account",
      entity_id: created.user.id,
      after: { email, role, display_name: displayName || null },
      note: null,
    });

    return NextResponse.json({
      id: created.user.id,
      email,
      role,
      // Says plainly what the admin now has to do, since the account is live
      // and unreachable by its owner until the password is passed on.
      password_known_to_admin: true,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
