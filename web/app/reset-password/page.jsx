"use client";
import { useState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { api, localUsers } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import {
  Button, Card, Input, Field, PageHeader, ErrorNote, Alert, Mono,
} from "@/components/ui";
import { CardContent } from "@/components/ui/card";

const MIN_LENGTH = 10;

/**
 * Where a password recovery link lands.
 *
 * Supabase sends the recipient to /auth/v1/verify, which redirects here with a
 * one-time token in the URL *fragment*. supabase-js has detectSessionInUrl on
 * by default, so by the time this renders the token has already been exchanged
 * for a session and stripped from the address bar — which is why a recovery
 * link used to end at a bare `/#` and appear to do nothing.
 *
 * Being signed in is therefore the normal state here, not an error. An expired
 * or already-used link establishes no session, and the AppShell gate shows the
 * sign-in form instead of this page.
 */
export default function ResetPasswordPage() {
  const { profile } = useAuth();
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
      setPassword("");
      setConfirm("");
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (localUsers) {
    return (
      <>
        <PageHeader title="Choose a new password" />
        <Alert tone="warn" title="Not available on the local test user base.">
          This app is running without Supabase credentials, so sign-in is the
          browser-local fixture in{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
            lib/users.js
          </code>
          , which stores passwords in plaintext and has no recovery flow.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Choose a new password"
        description={
          done
            ? undefined
            : "Replaces the password on your account immediately. Nobody — including an admin — can read the old one; it is stored only as a bcrypt hash."
        }
      />

      {done ? (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm font-medium text-success">Password updated.</p>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Your current session stays signed in. Use the new password next time.
            </p>
            <Button asChild className="mt-5">
              <Link href="/">Continue</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card as="form" onSubmit={submit} className="max-w-sm">
          <CardContent className="flex flex-col gap-4 p-5">
            {profile && (
              <Mono className="text-[11px]">
                Signed in as {profile.email || profile.display_name}
              </Mono>
            )}
            <Field
              label="New password"
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
      )}
    </>
  );
}
