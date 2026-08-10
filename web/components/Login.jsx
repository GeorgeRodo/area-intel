"use client";
import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/AuthContext";
import { localUsers } from "@/lib/api";
import { SEED_USERS } from "@/lib/users";
import { Button, Card, Input, Mono, Field, ErrorNote, Badge } from "@/components/ui";
import { CardContent } from "@/components/ui/card";

export default function Login() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await signIn(email, password);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  function useAccount(u) {
    setEmail(u.email);
    setPassword(u.password);
    setErr(null);
  }

  return (
    <main className="flex min-h-[85vh] items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <div className="text-xl font-semibold leading-none tracking-tight">
            Area<span className="text-muted-foreground">·</span>Intel
          </div>
          <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            verified intelligence, tiered
          </div>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mb-6 mt-1.5 text-sm text-muted-foreground">
          Accounts are created by the team. Admins manage the knowledge base;
          everyone else reads verified briefs.
        </p>

        <Card as="form" onSubmit={submit}>
          <CardContent className="flex flex-col gap-4 p-5">
            <Field label="Email">
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  value={email}
                  autoComplete="username"
                  onChange={(e) => setEmail(e.target.value)}
                  autoFocus
                />
              )}
            </Field>
            <Field label="Password">
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  value={password}
                  autoComplete="current-password"
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" loading={busy} disabled={!email || !password} className="w-full">
              {busy ? "Signing in…" : "Sign in"}
            </Button>
            {err && <ErrorNote className="text-[13px]">{err}</ErrorNote>}
          </CardContent>
        </Card>

        {!localUsers && (
          <p className="mt-4 text-[13px] text-muted-foreground">
            Been invited but never set a password?{" "}
            <Link href="/signup" className="underline underline-offset-2">
              Set up your account
            </Link>
            .
          </p>
        )}

        {localUsers && (
          <div className="mt-6">
            <Mono className="mb-2 block text-[10.5px] uppercase tracking-widest">
              Demo accounts — stored in this browser, not real auth
            </Mono>
            <div className="flex flex-col gap-2">
              {SEED_USERS.map((u) => (
                <button
                  key={u.email}
                  type="button"
                  onClick={() => useAccount(u)}
                  className="rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-[13px] font-medium">{u.display_name}</span>
                    <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                      {u.role}
                    </Badge>
                  </div>
                  <Mono className="text-[11px]">
                    {u.email} · {u.password}
                  </Mono>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
