"use client";
import { useState } from "react";
import {
  Trash2, UserPlus, RotateCcw, Users, MailPlus, X, Settings2, KeyRound, Mail,
} from "lucide-react";
import { api, localUsers } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useAuth } from "@/lib/AuthContext";
import {
  Button, Card, Input, Select, Mono, Badge, Field, Alert, ErrorNote, EmptyState,
  SkeletonCards, SectionHeader,
} from "@/components/ui";

/**
 * Accounts, roles and invitations. Since 0005 an account cannot exist without
 * an invite, so the invite list — not this account list — is where access is
 * actually granted. Roles remain service-role-only to change after the fact,
 * which is why the invite carries the role: it is the one moment an admin gets
 * to decide what someone will be.
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

  async function run(fn, ok) {
    setActionErr(null);
    setMsg(null);
    try {
      await fn();
      await Promise.all([reload(), reloadInvites()]);
      if (ok) setMsg(ok);
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

      {localUsers &&
        (adding ? (
          <AddUserForm
            onCancel={() => setAdding(false)}
            onCreate={async (u) => {
              await run(() => api.createUser(u), `${u.email} created`);
              setAdding(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setAdding(true)}>
              <UserPlus aria-hidden="true" /> Add account
            </Button>
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
          </div>
        ))}

      <SectionHeader icon={MailPlus} title="Invitations" className="mt-10" />
      <p className="mb-4 text-[13px] leading-relaxed text-muted-foreground">
        Signup is invite-only. An address must appear here before an account can
        be created for it — including from the Supabase dashboard — and the role
        on the invite is the role the account is created with.
        {!localUsers && (
          <>
            {" "}
            Inviting emails them a link to set a password. Their account exists
            from that moment, so they appear in the list above straight away,
            marked <Mono className="text-warning">unconfirmed</Mono> until they
            open it.
          </>
        )}
      </p>

      {inviteErr && <ErrorNote className="mb-3">{inviteErr}</ErrorNote>}

      <InviteForm onInvite={(email, role) => run(() => api.inviteUser(email, role), `${email} invited`)} />

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
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * `claimed_at` stopped meaning "this person signed up" the moment invitations
 * started sending email: inviteUserByEmail creates the account when the mail
 * goes out, so the trigger stamps claimed_at before the invitee has done
 * anything at all. Reporting that as "signed up" told the admin an invitation
 * had been accepted when it had only been sent.
 *
 * The honest signal is on the account itself — has it ever been signed in to —
 * so this row is matched against the directory rather than trusting the invite.
 */
function InviteRow({ invite, account, onRevoke }) {
  const accepted = Boolean(account?.last_sign_in_at);
  const awaiting = Boolean(account) && !accepted;

  const status = accepted
    ? { label: "signed up", tone: "text-success" }
    : awaiting
      ? { label: "emailed · not opened", tone: "text-warning" }
      : { label: "pending", tone: "text-muted-foreground" };

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{invite.email}</div>
        <Mono className="text-[11px]">
          {invite.role} · invited {new Date(invite.invited_at).toLocaleDateString()}
        </Mono>
      </div>
      <Mono className={status.tone}>{status.label}</Mono>
      {/* Revoke only where there is no account behind the address. Once one
          exists — which, with emailed invites, is immediately — deleting the
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

function InviteForm({ onInvite }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("user");
  const valid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  function submit(e) {
    e.preventDefault();
    if (!valid) return;
    onInvite(email.trim().toLowerCase(), role);
    setEmail("");
    setRole("user");
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
      <Button type="submit" disabled={!valid}>
        <MailPlus aria-hidden="true" /> Invite
      </Button>
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

  function after(fn, message) {
    return async () => {
      await onRun(fn, message);
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
                  hint="At least 10 characters. Nobody can read the existing one — it is stored as a bcrypt hash — so this replaces it."
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
                  disabled={password.length < 10}
                  onClick={after(
                    () => api.setUserPassword(u, password),
                    `Password replaced for ${u.display_name} — send it to them out of band`
                  )}
                >
                  <KeyRound aria-hidden="true" /> Set password
                </Button>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  disabled={!u.email}
                  onClick={after(
                    () => api.sendPasswordRecovery(u),
                    `Reset link sent to ${u.email}`
                  )}
                >
                  <Mail aria-hidden="true" /> Send reset link
                </Button>
                <p className="text-xs text-muted-foreground">
                  Preferred over setting one yourself: the password stays known
                  to one person, which is what makes the audit trail mean
                  anything.
                </p>
              </div>
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
                      `${u.email || u.id} deleted`
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

function AddUserForm({ onCreate, onCancel }) {
  const [email, setEmail] = useState("");
  const [display_name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("user");
  const valid = email.includes("@") && password.length >= 6;

  function submit(e) {
    e.preventDefault();
    if (valid) onCreate({ email, password, display_name, role });
  }

  return (
    <Card as="form" onSubmit={submit} className="w-full p-5">
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
        <Field label="Password" hint="At least 6 characters.">
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
