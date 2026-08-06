"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import { useMunicipalities } from "@/lib/MunicipalitiesContext";
import {
  Card, Input, Mono, PageHeader, SectionHeader, ErrorNote, EmptyState, SkeletonCards,
} from "@/components/ui";

/**
 * The reader's landing page: which areas we cover, and the promise the product
 * makes about every claim on them. Rendered both at "/areas" and at "/" for
 * non-admins, so it lives here rather than in one of those route files.
 */
export default function AreasView() {
  const { municipalities, loading, error } = useMunicipalities();
  const [q, setQ] = useState("");

  // Name, district, region and notes are all things someone would type: the
  // pilot area is as likely to be looked up as "Alentejo" or "Comporta" as by
  // the concelho's own name.
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return municipalities;
    return municipalities.filter((m) =>
      [m.name, m.district, m.region, m.notes]
        .filter(Boolean)
        .some((field) => field.toLowerCase().includes(needle))
    );
  }, [municipalities, q]);

  const searching = q.trim().length > 0;

  return (
    <div>
      <PageHeader
        eyebrow="Verified area intelligence · Portugal"
        title={
          <>
            Every claim carries a tier, a source, and a date.
            <br />
            <span className="text-muted-foreground">Unknown is an answer.</span>
          </>
        }
        description="Automated research drafts; a human verifies. Nothing reaches a brief until a team member signs it. What we have not verified is shown as a gap — not hidden, not guessed."
      />

      <SectionHeader
        icon={MapPin}
        title="Coverage areas"
        right={
          municipalities.length > 0 && (
            <div className="relative w-56 max-w-[50vw]">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="h-8 pl-8 text-[13px]"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search coverage areas"
                placeholder="area, district, region…"
              />
            </div>
          )
        }
      />

      {error && <ErrorNote className="mb-3">API unreachable: {error}</ErrorNote>}

      {searching && (
        <Mono className="mb-2 block">
          {filtered.length} of {municipalities.length} areas
        </Mono>
      )}

      {loading && municipalities.length === 0 ? (
        <SkeletonCards count={2} height="h-24" />
      ) : municipalities.length === 0 ? (
        <EmptyState icon={MapPin} title="Knowledge base empty.">
          Seed it with{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[12px]">
            python -m kb.seed_grandola
          </code>
          .
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon={Search} title={`Nothing matches “${q.trim()}”.`}>
          We cover {municipalities.length}{" "}
          {municipalities.length === 1 ? "area" : "areas"} so far — try a district
          or region instead.
        </EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {filtered.map((m) => (
            <Link key={m.id} href={`/brief/${m.id}`} className="block">
              <Card className="h-full p-5 transition-colors hover:bg-accent/50">
                <div className="font-semibold tracking-tight">{m.name}</div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {m.district} · {m.region}
                </div>
                {m.notes && (
                  <p className="mt-2 text-sm text-muted-foreground">{m.notes}</p>
                )}
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
