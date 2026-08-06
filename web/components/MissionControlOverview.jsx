"use client";
import { useState } from "react";
import { ArrowRight, LayoutGrid, Activity, Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { StatCard, RoutineRow, ActivityFeed } from "@/components/mission";
import {
  Button, Card, Mono, SectionHeader, ErrorNote, EmptyState, Skeleton,
} from "@/components/ui";

const POLL_MS = 15000;

export default function MissionControlOverview({ onOpenQueue }) {
  const [busy, setBusy] = useState(null);
  const [runErr, setRunErr] = useState(null);

  const { data, error, loading, refreshQuietly } = useAsync(
    async () => {
      const [kpis, routines, runs, findings] = await Promise.all([
        api.kpis(), api.routines(), api.runs(8), api.findings(),
      ]);
      return { kpis, routines, runs, findings };
    },
    [],
    { pollMs: POLL_MS }
  );

  async function runNow(name) {
    setBusy(name);
    setRunErr(null);
    try {
      await api.runNow(name);
      // The demo backend resolves instantly; a real worker needs a beat.
      await new Promise((r) => setTimeout(r, 600));
      await refreshQuietly();
    } catch (e) {
      setRunErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) {
    return (
      <div role="status" aria-label="Loading">
        <div className="mb-9 grid grid-cols-2 gap-4 md:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-5">
          <Skeleton className="h-64 rounded-xl lg:col-span-3" />
          <Skeleton className="h-64 rounded-xl lg:col-span-2" />
        </div>
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (error && !data) return <ErrorNote>{error}</ErrorNote>;

  const { kpis, routines, runs, findings } = data;

  return (
    <div>
      {(error || runErr) && <ErrorNote className="mb-4">{error || runErr}</ErrorNote>}

      <div className="mb-9 grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard statKey="pending_review" label="Waiting on you" value={kpis.pending_review}
          tone={kpis.pending_review ? "warn" : "neutral"} hint="pending findings" />
        <StatCard statKey="verified_nodes" label="Verified nodes" value={kpis.verified_nodes}
          tone="good" hint="live on briefs" />
        <StatCard statKey="stale_nodes" label="Stale" value={kpis.stale_nodes}
          tone={kpis.stale_nodes ? "bad" : "neutral"} hint="refresh queued" />
        <StatCard statKey="failed_runs_24h" label="Failed runs (24h)" value={kpis.failed_runs_24h}
          tone={kpis.failed_runs_24h ? "bad" : "neutral"} />
        <StatCard statKey="municipalities" label="Areas covered" value={kpis.municipalities}
          hint="municipalities" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionHeader
            icon={LayoutGrid}
            title="Routines"
            right={<Mono>{routines.length} registered</Mono>}
          />
          <Card className="px-5 py-1">
            {routines.map((r) => (
              <RoutineRow key={r.name} routine={r} onRunNow={runNow} busy={busy === r.name} />
            ))}
          </Card>

          <div className="mt-8">
            <SectionHeader icon={Activity} title="Recent activity" />
            <Card className="px-5 py-1">
              <ActivityFeed runs={runs} />
            </Card>
          </div>
        </div>

        <div className="lg:col-span-2">
          <SectionHeader
            icon={Inbox}
            title="Waiting on you"
            right={
              findings.length > 0 && (
                <button
                  type="button"
                  onClick={onOpenQueue}
                  className="flex items-center gap-1 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  open queue <ArrowRight className="size-3" aria-hidden="true" />
                </button>
              )
            }
          />
          <Card className="p-5">
            {findings.length === 0 ? (
              <EmptyState icon={Inbox} title="Queue empty. Nothing waiting." className="py-6" />
            ) : (
              <>
                <ul className="flex flex-col gap-3">
                  {findings.slice(0, 6).map((f) => (
                    <li key={f.id} className="border-b pb-3 last:border-0 last:pb-0">
                      <Mono className="text-[11px]">
                        #{f.id} · {f.category} · proposed {f.proposed_tier}
                      </Mono>
                      <div className="mt-0.5 text-sm font-medium leading-snug">{f.title}</div>
                    </li>
                  ))}
                </ul>
                <Button onClick={onOpenQueue} className="mt-5 w-full">
                  Review {findings.length} item{findings.length === 1 ? "" : "s"}
                  <ArrowRight aria-hidden="true" />
                </Button>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
