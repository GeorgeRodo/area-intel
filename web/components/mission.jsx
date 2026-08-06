import {
  Clock, CheckCircle2, XCircle, AlertTriangle, Play, Loader2,
  Inbox, Radar, TrendingUp, ShieldCheck, RotateCw, Database,
} from "lucide-react";
import { Card, Mono } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STATUS_META = {
  ok:      { dot: "bg-success",         icon: CheckCircle2,  cls: "text-success" },
  failed:  { dot: "bg-destructive",     icon: XCircle,       cls: "text-destructive" },
  skipped: { dot: "bg-warning",         icon: AlertTriangle, cls: "text-warning" },
  never:   { dot: "bg-muted-foreground/40", icon: Clock,     cls: "text-muted-foreground" },
};

const ROUTINE_ICON = {
  agent_tasks: Radar,
  freshness_sweep: RotateCw,
  dre_parser: ShieldCheck,
  portal_tracker: TrendingUp,
};

const STAT_ICON = {
  pending_review: Inbox, verified_nodes: ShieldCheck,
  stale_nodes: RotateCw, failed_runs_24h: XCircle, municipalities: Database,
};

const STAT_TONE = {
  neutral: { value: "text-foreground", icon: "text-muted-foreground", tint: "bg-muted" },
  good: { value: "text-foreground", icon: "text-success", tint: "bg-success/10" },
  warn: { value: "text-foreground", icon: "text-warning", tint: "bg-warning/10" },
  bad: { value: "text-foreground", icon: "text-destructive", tint: "bg-destructive/10" },
};

function timeAgo(iso) {
  if (!iso) return "never run";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/**
 * The number stays foreground in every tone: on a monochrome scale, colouring
 * the figure itself makes a bad number quieter than a good one. The tone rides
 * on the icon, which is the part that is meant to catch the eye.
 */
export function StatCard({ statKey, label, value, tone = "neutral", hint }) {
  const t = STAT_TONE[tone] || STAT_TONE.neutral;
  const Icon = STAT_ICON[statKey] || Database;
  return (
    <Card className="p-5 transition-shadow hover:shadow-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="max-w-[7rem] text-xs font-medium uppercase leading-tight tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", t.tint)}>
          <Icon className={cn("size-3.5", t.icon)} strokeWidth={2.25} aria-hidden="true" />
        </div>
      </div>
      <div className={cn("text-3xl font-semibold leading-none tracking-tight", t.value)}>
        {value}
      </div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}

/**
 * `routine.planned` marks a routine that is registered but has no
 * implementation behind it yet. It keeps its row — the roadmap is worth
 * showing — but loses the status dot, the schedule and the run button, so it
 * can never be mistaken for something that is running on a cadence.
 */
export function RoutineRow({ routine, onRunNow, busy }) {
  const planned = !!routine.planned;
  const status = routine.last_run?.status || "never";
  const meta = STATUS_META[status];
  const RIcon = ROUTINE_ICON[routine.name] || Radar;
  return (
    <div className={cn("flex items-center gap-3.5 border-b py-4 last:border-0", planned && "opacity-60")}>
      <div className="relative shrink-0">
        <div className="flex size-8 items-center justify-center rounded-md border bg-muted/50">
          <RIcon className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden="true" />
        </div>
        {!planned && (
          <span
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-background",
              meta.dot
            )}
          />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[13.5px] font-semibold tracking-tight">{routine.name}</span>
          {planned ? (
            <span className="rounded border px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              planned
            </span>
          ) : (
            <Mono className="text-[11px]">{routine.schedule}</Mono>
          )}
        </div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">
          {routine.description}
        </p>
        {routine.last_run?.detail && (
          <div className="mt-1 flex items-center gap-1">
            <meta.icon className={cn("size-3", meta.cls)} strokeWidth={2} aria-hidden="true" />
            <Mono className="text-[11px]">{routine.last_run.detail}</Mono>
          </div>
        )}
      </div>
      <Mono className="shrink-0 text-[11px]">
        {planned ? "not implemented" : timeAgo(routine.last_run?.started_at)}
      </Mono>
      {!planned && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onRunNow(routine.name)}
          disabled={busy}
          className="shrink-0"
        >
          {busy ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" /> Running
            </>
          ) : (
            <>
              <Play strokeWidth={2.5} aria-hidden="true" /> Run now
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export function ActivityFeed({ runs }) {
  if (!runs.length)
    return (
      <div className="py-8 text-center">
        <Clock className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">No activity yet.</p>
      </div>
    );
  return (
    <ul className="flex flex-col">
      {runs.map((r) => {
        const meta = STATUS_META[r.status] || STATUS_META.never;
        return (
          <li key={r.id} className="flex items-start gap-3 border-b py-3 last:border-0">
            <meta.icon
              className={cn("mt-0.5 size-3.5 shrink-0", meta.cls)}
              strokeWidth={2}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium">{r.routine}</span>{" "}
              <span className="text-[13px] text-muted-foreground">{r.detail}</span>
            </div>
            <Mono className="shrink-0 text-[11px]">{timeAgo(r.started_at)}</Mono>
          </li>
        );
      })}
    </ul>
  );
}
