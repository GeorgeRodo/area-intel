"use client";
import { useState } from "react";
import {
  Trash2, UserPlus, RotateCcw, Users, MailPlus, X, Settings2, KeyRound,
  Link as LinkIcon, Copy, Check,
} from "lucide-react";
import { api, localUsers } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useAuth } from "@/lib/AuthContext";
import {
  Button, Card, Input, Select, Mono, Badge, Field, Alert, ErrorNote, EmptyState,
  SkeletonCards, SectionHeader,
} from "@/components/ui";

// Mirrors MIN_PASSWORD_LENGTH in lib/server/admin.js, which cannot be imported
// here: that module holds the service role key and importing it from a client
// component is a build error by design. The server is the one that enforces it;
// this only exists so the form does not offer a password the route will refuse.
const MIN_PASSWORD = 10;

// The local user base has no real credentials to protect, and raising its floor
// would only lock people out of the seed accounts documented in TASKS.md.
const MIN_PASSWORD_LOCAL = 6;

// How long a generated invitation or recovery link stays usable. This is not
// ours to decide — it mirrors the project's Supabase setting (Authentication →
// Email), and 24h is that setting's default. Change it there and change it
// here, or the row will claim a link is live after it has stopped working.
// Getting it wrong is not dangerous, only misleading: the link either works or
// it does not, whatever this number says.
const INVITE_LINK_TTL_HOURS = 24;

/**
 * What has actually happened to this invitation, from the two sources that
 * know: the account row, and when a link was last minted.
 *
 * Signing in is the only definitive signal. `claimed_at` on the invite is not —
 * it is stamped the moment the account row appears, which for a link invite is
 * when the link is *generated*, so it says nothing about whether a person has
 * been anywhere near it.
 */
function inviteStatus(invite, account) {
  if (account?.last_sign_in_at) {
    return { label: "signed up", tone: "text-success" };
  }

  // No link ever minted. Either the row was allow-listed by hand, or the
  // account was made through Add account — which needs no link, so this is
  // "waiting on them to sign in", not "waiting on you to send something".
  if (!invite.link_generated_at) {
    return account
      ? { label: "ready · not signed in yet", tone: "text-muted-foreground" }
      : { label: "no link sent yet", tone: "text-muted-foreground", needsLink: true };
  }

  const ageMs = Date.now() - new Date(invite.link_generated_at).getTime();
  const leftMs = INVITE_LINK_TTL_HOURS * 3600_000 - ageMs;

  if (leftMs <= 0) {
    return { label: "link expired", tone: "text-destructive", needsLink: true };
  }
  const hours = Math.floor(leftMs / 3600_000);
  return {
    label: hours >= 1
      ? `link sent · expires in ${hours}h`
      : `link sent · expires in ${Math.max(1, Math.round(leftMs / 60_000))}m`,
    tone: "text-warning",
  };
}

/**
 * Accounts, roles and invitations. Since 0005 an account cannot exist without
 * an invite, so the invite list — not this account list — is where access is
 * actually granted. Roles remain service-role-only to change after the fact,
 * which is why the invite carries the role: it is the one moment an admin gets
 * to decide what someone will be.
 *
 * Two ways in, neither of which sends email:
 *
 *   Invite link — you get a URL and pass it on yourself. Preferred, because
 *                 the person sets their own password and nobody else ever
 *                 learns it. Expires; regenerating costs nothing.
 *   Add account — the account exists immediately with a password you set and
 *                 hand over. The only path where two people know a password,
 *                 so it is second choice, but it needs nothing of the
 *                 recipient beyond somewhere to type.
 *
 * There was a third — emailing the invitation through Supabase's built-in
 * mailer — and it is gone rather than deprecated. That mailer only delivers to
 * members of the Supabase organisation, and dropped anything else after
 * reporting the send as successful: no error, no bounce, nothing in any log. A
 * control that cannot tell you it failed is worse than its absence, and custom
 * SMTP is not on the roadmap, so the button went instead.
 */
export default function UsersPanel() {
  const { profile } = useAuth();
  const { data: users, error, loading, reload } = useAsync(() => api.users(), []);
  const {
    data: invites, error: inviteErr, loading: invitesLoading, reload: reloadInvites,
  } = useAsync(() => api.invites(), []);
  const [actionErr, setActionErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);
  const [linkResult, setLinkResult] = useState(null);

  /**
   * Returns whether the action succeeded, so a caller can keep what the admin
   * typed when it did not. `ok` may be a function of the result for the cases
   * where the response carries something worth saying — a deletion whose audit
   * row could not be written still deleted the account, and the admin has to
   * hear that in the same breath.
   */
  async function run(fn, ok) {
    setActionErr(null);
    setMsg(null);
    try {
      const result = await fn();
      await Promise.all([reload(), reloadInvites()]);
      if (ok) setMsg(typeof ok === "function" ? ok(result) : ok);
      return true;
    } catch (e) {
      setActionErr(e.message);
      return false;
    }
  }

  /**
   * Mint the link and put it straight on the clipboard — copying it is the
   * only reason to ask for one, so making that a second click is friction.
   *
   * The panel is kept strictly as a fallback. navigator.clipboard rejects on
   * insecure origins, under a restrictive permissions policy, and when the
   * document is not focused; reporting "copied" in those cases would destroy a
   * credential that cannot be re-read — the token is one-time, so the admin
   * would have to generate another and might not realise why. On failure the
   * link is shown instead, and it is never lost.
   */
  async function generateLink(email, role) {
    setActionErr(null);
    setMsg(null);
    setLinkResult(null);
    try {
      const result = await api.inviteLink(email, role);
      // No link at all is the local user base, where there is no Supabase Auth
      // to mint one against. Say what did happen rather than reporting a copy
      // that never occurred.
      if (!result.link) {
        setMsg(`${result.email} added to the invite list.`);
        await Promise.all([reload(), reloadInvites()]);
        return;
      }
      const kind = result.mode === "recovery" ? "Recovery" : "Invitation";
      try {
        await navigator.clipboard.writeText(result.link);
        setMsg(
          `${kind} link for ${result.email} copied — send it over a channel you ` +
            `trust. It expires in ${INVITE_LINK_TTL_HOURS}h, and anyone holding ` +
            `it can claim the account.`
        );
      } catch {
        setLinkResult(result);
      }
      await Promise.all([reload(), reloadInvites()]);
    } catch (e) {
      setActionErr(e.message);
    }
  }

  return (
    <div className="max-w-3xl">
      {localUsers && (
        <Alert tone="warn" title="Local user base — not authentication." className="mb-6">
          Accounts live in this browser&apos;s localStorage with plaintext passwords,
          and anyone with devtools can make themselves an admin. Fine for a design
          demo, unusable for a pilot. Tracked in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">TASKS.md</code>{" "}
          as the first thing to replace with Supabase Auth.
        </Alert>
      )}

      {(error || actionErr) && <ErrorNote className="mb-3">{error || actionErr}</ErrorNote>}
      {msg && (
        <p role="status" className="mb-3 font-mono text-[11px] text-success">
          {msg}
        </p>
      )}

      {loading && !users ? (
        <SkeletonCards count={3} height="h-16" className="mb-6" />
      ) : users?.length === 0 ? (
        <EmptyState icon={Users} title="No accounts." className="mb-6" />
      ) : (
        <div className="flex flex-col gap-2.5 mb-6">
          {users?.map((u) => (
            <UserRow key={u.email || u.id} user={u} profile={profile} onRun={run} />
          ))}
        </div>
      )}

      {adding ? (
        <AddUserForm
          onCancel={() => setAdding(false)}
          onCreate={async (u) => {
            const ok = await run(
              () => api.createUser(u),
              localUsers
                ? `${u.email} created`
                : `${u.email} created and ready to sign in — nothing was emailed, ` +
                  `so send them the password yourself and ask them to change it.`
            );
            // Leave the form up on failure: it still holds everything they
            // typed, including a password they would otherwise have to invent
            // again and would probably invent differently.
            if (ok) setAdding(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setAdding(true)}>
            <UserPlus aria-hidden="true" /> Add account
          </Button>
          {localUsers && (
            <Button
              variant="outline"
              onClick={() =>
                run(
                  () => api.resetUsers(),
                  "Seed accounts restored — you will be signed out on reload"
                )
              }
            >
              <RotateCcw aria-hidden="true" /> Reset to seed accounts
            </Button>
          )}
        </div>
      )}

      <SectionHeader icon={MailPlus} title="Invitations" className="mt-10" />
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Signup is invite-only. An address must appear here before an account can
        be created for it — including from the Supabase dashboard — and the role
        on the invite is the role the account is created with.
        {!localUsers && (
          <>
            {" "}
            Nothing is emailed: you get a link to pass on however you already
            reach the person. Their account exists from the moment you generate
            it, so they appear in the list above straight away, marked{" "}
            <Mono className="text-warning">unconfirmed</Mono> until they open it
            and choose a password.
          </>
        )}
      </p>

      {inviteErr && <ErrorNote className="mb-3">{inviteErr}</ErrorNote>}

      <InviteForm onLink={generateLink} />

      {linkResult && (
        <InviteLinkBox result={linkResult} onDismiss={() => setLinkResult(null)} />
      )}

      {invitesLoading && !invites ? (
        <SkeletonCards count={2} height="h-14" className="mt-4" />
      ) : invites?.length === 0 ? (
        <EmptyState icon={MailPlus} title="No invitations yet." className="mt-4" />
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {invites?.map((i) => (
            <InviteRow
              key={i.email}
              invite={i}
              account={users?.find(
                (u) => u.email?.toLowerCase() === i.email?.toLowerCase()
              )}
              onRevoke={() => run(() => api.revokeInvite(i.email), `${i.email} revoked`)}
              onLink={generateLink}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One invited address, and what has actually become of it.
 *
 * `claimed_at` on the invite is not the answer, even though it looks like it:
 * it is stamped when the account row appears, and generating a link creates
 * that row immediately — so it goes true the moment *you* press the button,
 * before the invitee has done anything at all. The row is matched against the
 * account directory instead, and `inviteStatus` reads the two signals that mean
 * something: whether it has ever been signed in to, and when a link was last
 * minted for it.
 */
function InviteRow({ invite, account, onRevoke, onLink }) {
  const accepted = Boolean(account?.last_sign_in_at);
  const awaiting = Boolean(account) && !accepted;
  const status = inviteStatus(invite, account);

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{invite.email}</div>
        <Mono className="text-[11px]">
          {invite.role} · invited {new Date(invite.invited_at).toLocaleDateString()}
        </Mono>
      </div>
      <Mono className={status.tone}>{status.label}</Mono>

      {/* Anyone who has not got in yet may need a link again — the old one
          expired, or never reached them. Regenerating costs nothing and
          invalidates nothing they were going to use anyway. Emphasised once the
          row is asking for it, so an expired invitation reads as a thing to
          act on rather than a thing to worry about. */}
      {!accepted && (
        <Button
          variant={status.needsLink ? "default" : "outline"}
          size="sm"
          aria-label={`Copy a new invitation link for ${invite.email}`}
          onClick={() => onLink(invite.email, invite.role)}
        >
          <Copy aria-hidden="true" />
          {invite.link_generated_at ? "New link" : "Copy link"}
        </Button>
      )}

      {/* Revoke only where there is no account behind the address. Once one
          exists — which, since generating a link creates one, is immediately —
          deleting the
          invite row would erase the record of how access was granted without
          removing the access. Undoing that is a delete in the list above. */}
      {!account ? (
        <Button variant="outline" size="icon" aria-label={`Revoke invite for ${invite.email}`}
          title={`Revoke ${invite.email}`} onClick={onRevoke}>
          <X aria-hidden="true" />
        </Button>
      ) : (
        awaiting && (
          <Mono className="text-[10.5px]">delete the account above to undo</Mono>
        )
      )}
    </Card>
  );
}

function InviteForm({ onLink }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function clear() {
    setEmail("");
    setRole("user");
  }

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    onLink(email.trim().toLowerCase(), role);
    clear();
  }

  return (
    <Card as="form" onSubmit={submit} className="flex flex-wrap items-end gap-3 p-4">
      <div className="min-w-[14rem] flex-1">
        <Field label="Email">
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="off"
              placeholder="colleague@firm.pt"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="Role">
        {({ id }) => (
          <Select id={id} className="w-28" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="user">user</option>
            <option value="admin">admin</option>
          </Select>
        )}
      </Field>
      {/* One button, because there is only one way in now. The emailed
          invitation is gone: Supabase's built-in mailer only delivers to
          members of the Supabase organisation and dropped everything else
          without an error, so it was a button that could fail silently. */}
      <Button type="submit" disabled={!valid}>
        <Copy aria-hidden="true" /> Copy invite link
      </Button>
    </Card>
  );
}

/**
 * Fallback for when the clipboard write failed. The happy path copies the link
 * and says so in one line; this only appears if the browser refused, and it
 * exists so a one-time token is never minted and then lost.
 *
 * The link is rendered as selectable text as well as behind a Copy button,
 * since the reason we are here at all is that copying did not work. Dismissible
 * on purpose: it is a credential and should not sit on screen once passed on.
 */
function InviteLinkBox({ result, onDismiss }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card className="mt-4 flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionHeader
          icon={LinkIcon}
          title={`Invitation link for ${result.email}`}
          className="mb-0"
        />
        <Button variant="ghost" size="icon" aria-label="Dismiss link" onClick={onDismiss}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          readOnly
          value={result.link}
          onFocus={(e) => e.target.select()}
          className="min-w-[18rem] flex-1 font-mono text-[11px]"
          aria-label="Invitation link"
        />
        <Button variant="outline" onClick={copy}>
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Your browser blocked the clipboard, so here is the link — copy it before
        dismissing, it cannot be shown again.{" "}
        {result.mode === "recovery"
          ? "That address already had an account, so this is a recovery link — it reopens the existing one rather than creating another."
          : `Creates the account as ${result.role} when opened. It is already on the invite list.`}{" "}
        <strong className="font-medium text-foreground">
          Anyone holding this link can claim the account
        </strong>
        , so send it over a channel you trust. It expires in about 24 hours.
      </p>
    </Card>
  );
}

/**
 * One account, with its management panel folded away until asked for.
 *
 * The controls differ by what the backing store can actually do, not by
 * cosmetics. On the local user base there are no passwords worth managing and
 * no audit log to write to, so the panel is just role and delete. On Supabase
 * every action needs a reason, because each one writes an audit_log row —
 * which is the only trace that survives a deleted account.
 */
function UserRow({ user: u, profile, onRun }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState(u.role);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // On Supabase the uuid is the identity: profiles has no email column, and
  // api.myProfile carries id/email over from the session so this comparison
  // works. On the local user base the email is authoritative and there is no
  // id at all.
  const isSelf = Boolean(
    profile && (u.id ? u.id === profile.id : u.email && u.email === profile.email)
  );

  // A reason is asked for only where the action destroys the thing it applies
  // to. A role change or a password reset is legible after the fact — the
  // audit row still records who did what, and the account is right there to
  // look at. A deletion leaves nothing behind but the audit row, so that row
  // has to carry the justification or it is lost with the account.
  const needNote = !localUsers;
  const reason = note.trim();
  const deleteReasonOk = !needNote || reason.length > 0;

  // Clear only on success. Wiping the field after a failure made the admin
  // retype the reason for a deletion that had just been refused, which is
  // exactly when they are least inclined to write a careful one.
  function after(fn, message) {
    return async () => {
      if (!(await onRun(fn, message))) return;
      setNote("");
      setPassword("");
      setConfirmDelete(false);
    };
  }

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            {u.display_name} {isSelf && <Mono className="text-foreground">you</Mono>}
          </div>
          <Mono className="text-[11px]">{u.email || u.id}</Mono>
        </div>

        <Badge variant={u.role === "admin" ? "default" : "secondary"} className="shrink-0">
          {u.role || "no profile"}
        </Badge>

        {/* Never confirmed means the invite was accepted but the address was
            never proven, so a reset link would go somewhere unverified. */}
        {!localUsers && u.confirmed === false && (
          <Mono className="shrink-0 text-warning">unconfirmed</Mono>
        )}

        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <Settings2 aria-hidden="true" /> {open ? "Close" : "Manage"}
        </Button>
      </div>

      {open && (
        <div className="mt-4 flex flex-col gap-4 border-t pt-4">
          {/* ---- role ---- */}
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Role" className="w-32">
              {({ id }) => (
                <Select
                  id={id}
                  value={role}
                  disabled={isSelf}
                  title={isSelf ? "You cannot change your own role" : undefined}
                  onChange={(e) => setRole(e.target.value)}
                >
                  <option value="admin">admin</option>
                  <option value="user">user</option>
                </Select>
              )}
            </Field>
            <Button
              variant="outline"
              disabled={isSelf || role === u.role}
              onClick={after(
                () => api.setUserRole(u, role),
                `${u.display_name} is now ${role}`
              )}
            >
              Save role
            </Button>
            {isSelf && (
              <p className="text-xs text-muted-foreground">
                You cannot change your own role — an admin who demotes themselves
                has no way back.
              </p>
            )}
          </div>

          {/* ---- password ---- */}
          {!localUsers && (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <Field
                  label="New password"
                  className="min-w-[16rem] flex-1"
                  hint={`At least ${MIN_PASSWORD} characters. Nobody can read the existing one — it is stored as a bcrypt hash — so this replaces it. Signing them out everywhere is part of the same action: any session they already had stops renewing, and dies when its current token expires.`}
                >
                  {({ id, ...aria }) => (
                    <Input
                      id={id}
                      {...aria}
                      type="password"
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  )}
                </Field>
                <Button
                  variant="outline"
                  disabled={password.length < MIN_PASSWORD}
                  onClick={after(
                    () => api.setUserPassword(u, password),
                    // A function of the result, because the interesting half of
                    // this action is the half that can fail on its own. The
                    // password is definitely changed by the time this runs; the
                    // sessions may or may not be gone, and an admin resetting a
                    // departed colleague's password needs to know which.
                    (res) => {
                      const sent = `Password replaced for ${u.display_name} — send it to them out of band.`;

                      if (res?.revocation_failed) {
                        return (
                          `${sent} Their existing sessions could NOT be ended, so a ` +
                          `browser that was already signed in still has access. ` +
                          `Check the server log before treating this account as closed.`
                        );
                      }

                      const n = res?.revoked?.sessions ?? 0;
                      // Zero is a real, fine answer — nobody was signed in — and
                      // reads very differently from the failure above.
                      const ended = n === 0
                        ? " They had no active session."
                        : ` ${n} active session${n === 1 ? "" : "s"} ended.`;
                      const mine = res?.self
                        ? " That included your own, so you will be signed out when your current token expires."
                        : "";

                      return sent + ended + mine;
                    }
                  )}
                >
                  <KeyRound aria-hidden="true" /> Set password
                </Button>
              </div>

              {/* Setting a password also ends the account's sessions (0014).
                  Without that the reset closed nothing: Supabase leaves the
                  existing refresh tokens valid, so the browser that was already
                  signed in renewed itself straight through a reset performed
                  because it should no longer have access.

                  "Send reset link" used to sit here and is gone with the rest
                  of the email paths. It called Supabase's built-in mailer,
                  which only delivers to members of the Supabase organisation —
                  so for most of this project's users it reported success and
                  delivered nothing, leaving both sides waiting. A control that
                  cannot fail visibly is worse than no control.

                  For someone who has never signed in, the Invitations list
                  below still mints them a link. For someone who has, setting a
                  password here is the remaining route: worse in principle,
                  since two people then know it, but it works and it is honest
                  about what it did. */}
            </>
          )}

          {/* ---- delete ---- */}
          <div className="flex flex-col gap-3 border-t pt-4">
            {confirmDelete ? (
              <>
                {/* The reason lives here and nowhere else: this is the one
                    action whose subject does not survive it, so the audit row
                    is the only place the "why" can still be read afterwards. */}
                {needNote && (
                  <Field
                    label="Reason for deleting"
                    hint="Written to the audit log with your name against it. The account will be gone; this is what remains."
                  >
                    {({ id, ...aria }) => (
                      <Input
                        id={id}
                        {...aria}
                        value={note}
                        placeholder="e.g. left the firm on 8 Aug"
                        onChange={(e) => setNote(e.target.value)}
                        autoFocus
                      />
                    )}
                  </Field>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="destructive"
                    disabled={!deleteReasonOk}
                    onClick={after(
                      () => api.deleteUser(u, reason),
                      (res) =>
                        res?.audited === false
                          ? `${u.email || u.id} deleted — but the audit row could ` +
                            `not be written. That reason is now recorded nowhere: ` +
                            `write it down yourself.`
                          : `${u.email || u.id} deleted`
                    )}
                  >
                    <Trash2 aria-hidden="true" /> Delete permanently
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setConfirmDelete(false);
                      setNote("");
                    }}
                  >
                    Cancel
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    Irreversible. Their invite is dropped too, so re-admitting
                    them means a fresh invite.
                  </p>
                </div>
              </>
            ) : (
              <Button
                variant="outline"
                // The container is a column now that the reason field sits in
                // it; without this the button stretches the full panel width.
                className="self-start"
                disabled={isSelf}
                title={isSelf ? "You cannot delete your own account" : undefined}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" /> Delete account
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Create an account directly, with no email in the path.
 *
 * Against Supabase this allow-lists the address and creates the account in one
 * call, so the person can sign in the moment the admin tells them how. That is
 * the whole point of it — and also the thing to be uncomfortable about, since
 * it is the only place in this system where somebody other than the account
 * holder knows their password. The form says so rather than leaving the admin
 * to notice.
 */
function AddUserForm({ onCreate, onCancel }) {
  const [email, setEmail] = useState("");
  const [display_name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");

  const minLength = localUsers ? MIN_PASSWORD_LOCAL : MIN_PASSWORD;
  const valid =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) && password.length >= minLength;

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    onCreate({ email: email.trim().toLowerCase(), password, display_name, role });
  }

  return (
    <Card as="form" onSubmit={submit} className="w-full p-5">
      {!localUsers && (
        <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
          Creates the account immediately and emails nothing, so it works when
          invitations do not. You choose the password and pass it on — which
          makes this the one account here whose password is known to two people.
          Where email or a{" "}
          <strong className="font-medium text-foreground">Copy link</strong>{" "}
          will reach them, prefer those: the person picks their own and nobody
          else ever sees it.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email">
          {({ id }) => (
            <Input
              id={id}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          )}
        </Field>
        <Field label="Display name">
          {({ id }) => (
            <Input id={id} value={display_name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field
          label="Password"
          hint={
            localUsers
              ? `At least ${minLength} characters.`
              : `At least ${minLength} characters. They should change it once they are in.`
          }
        >
          {({ id, ...aria }) => (
            <Input
              id={id}
              {...aria}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          )}
        </Field>
        <Field label="Role">
          {({ id }) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="user">user</option>
              <option value="admin">admin</option>
            </Select>
          )}
        </Field>
      </div>
      <div className="mt-5 flex gap-2">
        <Button type="submit" disabled={!valid}>
          Create
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
