"use client";
import { useState } from "react";
import Link from "next/link";
import { UserPlus, KeyRound, MailCheck } from "lucide-react";
import { api, localUsers } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import {
  Button, Card, Input, Field, PageHeader, ErrorNote, Alert, Mono,
} from "@/components/ui";
import { CardContent } from "@/components/ui/card";

const MIN_LENGTH = 10;

/**
 * Account creation, in the two shapes it actually arrives in.
 *
 *  - **Completing an invite.** The invitation email goes through Supabase's
 *    /auth/v1/verify, which exchanges a one-time token for a session and
 *    redirects here. So an invitee lands already signed in, with an account
 *    that has no password: inviteUserByEmail creates the row when the mail is
 *    sent, not when it is opened. All that is left is choosing a password.
 *
 *  - **Signing up cold.** Someone who was allow-listed but never emailed, or
 *    whose invite link expired. Email, password, name.
 *
 * Neither branch checks the allow-list. handle_new_user() (0005) raises for an
 * uninvited address and takes the auth.users insert down with it, so the rule
 * lives in the database where a client cannot route around it. This page only
 * has to render the refusal in language a person can act on.
 */
export default function SignupPage() {
  const { session } = useAuth();
  const completingInvite = Boolean(session);

  if (localUsers) {
    return (
      <>
        <PageHeader title="Create your account" />
        <Alert tone="warn" title="Not available on the local test user base.">
          The app is running without Supabase credentials, so accounts come from
          the fixture in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
            lib/users.js
          </code>
          . Sign in with one of the demo accounts on the login screen instead.
        </Alert>
      </>
    );
  }

  return completingInvite ? <CompleteInvite /> : <ColdSignup />;
}

/* ------------------------------------------------------------------ *
 * Arrived from an invitation email — account exists, password does not
 * ------------------------------------------------------------------ */

function CompleteInvite() {
  const { profile, session } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(null);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = password.length >= MIN_LENGTH && confirm === password;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.setMyPassword(password);
      setDone(true);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <PageHeader title="You're all set" />
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">
              Your password is set and you are signed in. Use it next time.
            </p>
            <Button asChild className="mt-5">
              <Link href="/">Go to the app</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      {/* Deliberately not "finish setting up your account": a session here
          usually means an invitation link was just opened, but it can equally
          be an admin who navigated to /signup while already signed in, and
          telling them their account was just created would be a lie. Setting
          a password is the true description of both. */}
      <PageHeader
        title="Set your password"
        description="Choose a password for this account. If you arrived from an invitation, this is the last step."
      />
      <Card as="form" onSubmit={submit} className="max-w-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <Mono className="text-[11px]">
            {session?.user?.email}
            {profile?.role ? ` · ${profile.role}` : ""}
          </Mono>
          <Field
            label="Password"
            hint={`At least ${MIN_LENGTH} characters.`}
            error={tooShort ? `At least ${MIN_LENGTH} characters.` : undefined}
          >
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field
            label="Confirm password"
            error={mismatch ? "The two do not match." : undefined}
          >
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={!valid || busy}>
            <KeyRound aria-hidden="true" />
            {busy ? "Saving…" : "Set password"}
          </Button>
          {err && <ErrorNote className="text-[13px]">{err}</ErrorNote>}
        </CardContent>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * No session — allow-listed but never emailed, or an expired link
 * ------------------------------------------------------------------ */

function ColdSignup() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [err, setErr] = useState(null);

  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const valid = emailOk && password.length >= MIN_LENGTH && confirm === password;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      setResult(await api.signUp(email.trim().toLowerCase(), password, displayName));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <>
        <PageHeader title="Account created" />
        <Card>
          <CardContent className="p-5">
            {result.needsConfirmation ? (
              <>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <MailCheck className="size-4" aria-hidden="true" /> Confirm your
                  email address
                </p>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  We sent a link to {email}. Click it, then sign in.
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                You are signed in and ready to go.
              </p>
            )}
            <Button asChild className="mt-5">
              <Link href="/">Continue</Link>
            </Button>
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Create your account"
        description="Sign-up is invite-only: the address has to have been invited by an admin before an account can exist for it."
      />
      <Card as="form" onSubmit={submit} className="max-w-sm">
        <CardContent className="flex flex-col gap-4 p-5">
          <Field label="Email">
            {({ id }) => (
              <Input
                id={id}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
              />
            )}
          </Field>
          <Field label="Display name" hint="Optional. Defaults to the part before the @.">
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            )}
          </Field>
          <Field
            label="Password"
            hint={`At least ${MIN_LENGTH} characters.`}
            error={tooShort ? `At least ${MIN_LENGTH} characters.` : undefined}
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
          <Field
            label="Confirm password"
            error={mismatch ? "The two do not match." : undefined}
          >
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            )}
          </Field>
          <Button type="submit" loading={busy} disabled={!valid || busy}>
            <UserPlus aria-hidden="true" />
            {busy ? "Creating…" : "Create account"}
          </Button>
          {err && <ErrorNote className="text-[13px]">{err}</ErrorNote>}
          <p className="text-xs text-muted-foreground">
            Already have an account? <Link href="/" className="underline">Sign in</Link>.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
