"use client";
import { demoData, localUsers } from "@/lib/api";

/**
 * The ribbon has to be precise about which half is fake, because the two
 * migrate separately: once accounts are on Supabase Auth, telling the operator
 * that sign-in is a local fixture is worse than saying nothing.
 */
export default function DemoRibbon() {
  if (!demoData) return null;
  return (
    <div className="border-b bg-muted px-4 py-1.5 text-center font-mono text-[11px] tracking-wide text-muted-foreground">
      {localUsers ? (
        <>
          DEMO DATA — not connected to the knowledge base, and sign-in runs on a
          local test user base. All content illustrative; the review loop is
          fully clickable.
        </>
      ) : (
        <>
          DEMO DATA — accounts and invitations are live on Supabase Auth, but
          every claim, area and routine below is illustrative fixture data.
        </>
      )}
    </div>
  );
}
