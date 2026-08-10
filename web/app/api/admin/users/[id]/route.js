import { NextResponse } from "next/server";
import { requireAdmin, audit, errorResponse, requireNote, HttpError } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/admin/users/[id] — remove an account for good.
 *
 * Note the asymmetry with the knowledge base, where nothing is ever deleted
 * and a false claim is retired to 'rejected' with its history intact. A person
 * is not a claim: keeping their account and address on file after they have
 * been removed is a liability, not a record. What survives is the audit row,
 * which is why a reason is required.
 */
export async function DELETE(request, { params }) {
  try {
    const { svc, caller } = await requireAdmin(request);
    const targetId = params.id;

    const body = await request.json().catch(() => ({}));
    const note = requireNote(body.note);

    if (targetId === caller.id) {
      throw new HttpError(400, "You cannot delete your own account.");
    }

    const { data: target, error: lookupErr } = await svc.auth.admin.getUserById(targetId);
    if (lookupErr || !target?.user) throw new HttpError(404, "No such account.");

    // Captured before the delete: profiles cascades from auth.users
    // (0001: `references auth.users(id) on delete cascade`), so a moment from
    // now there is nothing left to describe what was removed.
    const { data: profile } = await svc
      .from("profiles")
      .select("role, display_name")
      .eq("id", targetId)
      .single();

    if (profile?.role === "admin") {
      const { count } = await svc
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin");
      if ((count ?? 0) <= 1) {
        throw new HttpError(400, "That is the last admin — promote someone else first.");
      }
    }

    const { error } = await svc.auth.admin.deleteUser(targetId);
    if (error) throw new HttpError(502, error.message);

    // The invite was stamped claimed_at at signup, and handle_new_user() only
    // accepts invites where claimed_at is null. Leaving the row behind would
    // make the address permanently un-inviteable — the account is gone, but
    // nobody could ever be given that address again. Dropping it means
    // re-admitting them is a fresh, deliberate invite.
    if (target.user.email) {
      const { error: inviteErr } = await svc
        .from("invited_emails")
        .delete()
        .eq("email", target.user.email.toLowerCase());
      if (inviteErr) {
        console.error("[admin] could not clear invite for deleted user:", inviteErr.message);
      }
    }

    await audit(svc, caller, {
      action: "delete_account",
      entity_id: targetId,
      before: {
        email: target.user.email,
        role: profile?.role ?? null,
        display_name: profile?.display_name ?? null,
      },
      note,
    });

    return NextResponse.json({ deleted: targetId });
  } catch (e) {
    return errorResponse(e);
  }
}
