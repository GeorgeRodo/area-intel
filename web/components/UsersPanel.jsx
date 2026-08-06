"use client";
import { useState } from "react";
import { Trash2, UserPlus, RotateCcw, Users } from "lucide-react";
import { api, demoMode } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useAuth } from "@/lib/AuthContext";
import {
  Button, Card, Input, Select, Mono, Field, Alert, ErrorNote, EmptyState, SkeletonCards,
} from "@/components/ui";

/**
 * Accounts and roles. In demo mode this reads and writes the local user base
 * in lib/users.js (browser storage, plaintext passwords, temporary — see
 * TASKS.md). Against Supabase it is read-only: accounts live in Supabase Auth
 * and profiles.role is service-role-only by design.
 */
export default function UsersPanel() {
  const { profile } = useAuth();
  const { data: users, error, loading, reload } = useAsync(() => api.users(), []);
  const [actionErr, setActionErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [adding, setAdding] = useState(false);

  async function run(fn, ok) {
    setActionErr(null);
    setMsg(null);
    try {
      await fn();
      await reload();
      if (ok) setMsg(ok);
    } catch (e) {
      setActionErr(e.message);
    }
  }

  return (
    <div className="max-w-3xl">
      {demoMode && (
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

      {demoMode &&
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
    </div>
  );
}

function UserRow({ user: u, profile, onRun }) {
  const id = u.email || u.id;
  // Supabase profiles carry no email column, so identity falls back to the
  // display name there; in demo mode the email is authoritative.
  const isSelf = Boolean(
    profile && (u.email ? u.email === profile.email : u.display_name === profile.display_name)
  );
  const locked = !demoMode || isSelf;
  const lockReason = isSelf
    ? "You cannot change your own account"
    : "Managed in Supabase Auth — see TASKS.md";

  return (
    <Card className="flex flex-wrap items-center gap-3 p-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">
          {u.display_name} {isSelf && <Mono className="text-foreground">you</Mono>}
        </div>
        <Mono className="text-[11px]">{id}</Mono>
      </div>
      <Select
        // Controls are w-full by default; inside this row it needs to be a chip.
        // className lands on the field wrapper — see components/ui/select.jsx.
        className="w-28 shrink-0"
        value={u.role}
        disabled={locked}
        aria-label={`Role for ${u.display_name}`}
        title={locked ? lockReason : undefined}
        onChange={(e) =>
          onRun(
            () => api.setUserRole(u.email, e.target.value),
            `${u.display_name} is now ${e.target.value}`
          )
        }
      >
        <option value="admin">admin</option>
        <option value="user">user</option>
      </Select>
      <Button
        variant="outline"
        size="icon"
        disabled={locked}
        aria-label={`Delete ${u.display_name}`}
        title={locked ? lockReason : `Delete ${id}`}
        onClick={() => onRun(() => api.deleteUser(u.email), `${id} deleted`)}
      >
        <Trash2 aria-hidden="true" />
      </Button>
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
