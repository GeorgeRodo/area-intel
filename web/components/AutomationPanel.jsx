"use client";
import { useMemo, useState } from "react";
import { Bot, ScrollText, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { RoutineRow, ActivityFeed } from "@/components/mission";
import { Card, Mono, SectionHeader, ErrorNote, EmptyState, SkeletonCards } from "@/components/ui";
import { cn } from "@/lib/utils";

const POLL_MS = 15000;

/**
 * The automation layer: every routine that can put something into the
 * knowledge base without a human starting it. Nothing here writes to a brief
 * directly — routines produce findings, the review queue promotes them.
 */
export default function AutomationPanel() {
  const [busy, setBusy] = useState(null);
  const [runErr, setRunErr] = useState(null);

  const { data, error, loading, refreshQuietly } = useAsync(
    async () => {
      const [routines, runs] = await Promise.all([api.routines(), api.runs(40)]);
      return { routines, runs };
    },
    [],
    { pollMs: POLL_MS }
  );

  const routines = data?.routines ?? [];
  const runs = data?.runs ?? [];

  async function runNow(name) {
    setBusy(name);
    setRunErr(null);
    try {
      await api.runNow(name);
      await new Promise((r) => setTimeout(r, 600)); // real worker needs a beat
      await refreshQuietly();
    } catch (e) {
      setRunErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  const day = useMemo(() => {
    const since = Date.now() - 864e5;
    const recent = runs.filter((r) => new Date(r.started_at).getTime() >= since);
    return {
      runs: recent.length,
      failed: recent.filter((r) => r.status === "failed").length,
      produced: recent.reduce((n, r) => n + (r.items_out || 0), 0),
    };
  }, [runs]);

  if (loading && !data) return <SkeletonCards count={3} height="h-24" />;

  return (
    <div>
      {(error || runErr) && <ErrorNote className="mb-4">{error || runErr}</ErrorNote>}

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Planned routines are listed but not counted here: this number is
            "what can run", not "what is on the roadmap". */}
        <MiniStat icon={Bot} label="Registered" value={routines.filter((r) => !r.planned).length} />
        <MiniStat icon={Zap} label="Runs (24h)" value={day.runs} />
        <MiniStat icon={ScrollText} label="Items produced (24h)" value={day.produced} />
        <MiniStat
          icon={Zap}
          label="Failures (24h)"
          value={day.failed}
          iconTone={day.failed ? "text-destructive" : undefined}
        />
      </div>

      <SectionHeader icon={Bot} title="Routines & agents" />
      <Card className="mb-8 px-5 py-1">
        {routines.length === 0 ? (
          <EmptyState icon={Bot} title="No routines registered.">
            Routines are declared in the registry and picked up by the worker.
          </EmptyState>
        ) : (
          routines.map((r) => (
            <RoutineRow key={r.name} routine={r} onRunNow={runNow} busy={busy === r.name} />
          ))
        )}
      </Card>

      <SectionHeader
        icon={ScrollText}
        title="Run log"
        right={<Mono>last {runs.length}</Mono>}
      />
      <Card className="px-5 py-1">
        <ActivityFeed runs={runs} />
      </Card>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value, iconTone }) {
  return (
    <Card className="p-4">
      <div className="mb-2 flex items-center gap-1.5">
        <Icon
          className={cn("size-3.5 text-muted-foreground", iconTone)}
          strokeWidth={2}
          aria-hidden="true"
        />
        <span className="text-[10.5px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="text-2xl font-semibold leading-none tracking-tight">{value}</div>
    </Card>
  );
}
