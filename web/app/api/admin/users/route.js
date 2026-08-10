import { NextResponse } from "next/server";
import { requireAdmin, errorResponse } from "@/lib/server/admin";

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
