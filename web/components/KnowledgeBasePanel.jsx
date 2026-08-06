"use client";
import { useMemo, useState } from "react";
import { Search, Archive, ShieldCheck, RotateCw, FileWarning, Database } from "lucide-react";
import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { CATEGORIES, TIERS, TIER_BORDER } from "@/lib/labels";
import { TierChip } from "@/components/intel";
import {
  Button, Card, Input, Select, Mono, Field, ErrorNote, EmptyState, SkeletonCards, Progress,
} from "@/components/ui";
import { cn } from "@/lib/utils";

const STATUSES = ["draft", "pending_review", "verified", "stale", "rejected"];
const TIER_KEYS = ["A", "B", "C", "D"];

/* The statuses an admin may set by hand. 'draft' and 'pending_review' belong
   to the agent/review pipeline — set_node_status refuses them, because a node
   pushed back into the queue would have no finding behind it to dispose of. */
const SETTABLE_STATUSES = ["verified", "stale", "rejected"];

/* The reliability ladder. A/B/C are the three verified tiers a claim can hold;
   D is the holding bucket for anything not yet verified — it is shown here
   because unverified volume is the number that tells you where the work is. */
const LADDER = [
  { tier: "A", rung: "Verified primary", note: "registry, official publication, direct measurement" },
  { tier: "B", rung: "Verified secondary", note: "reputable report, credentialed expert on record" },
  { tier: "C", rung: "Professional hearsay", note: "industry consensus, informal network intel" },
];
const UNVERIFIED = { tier: "D", rung: "Unverified", note: "single source, potential capture, unconfirmed" };

export default function KnowledgeBasePanel() {
  const { data: nodes, error, loading, reload } = useAsync(() => api.allNodes(), []);
  const [q, setQ] = useState("");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState("");
  const [category, setCategory] = useState("");

  const stats = useMemo(() => {
    const all = nodes || [];
    const byTier = Object.fromEntries(
      TIER_KEYS.map((t) => [t, all.filter((n) => n.tier === t).length])
    );
    return {
      byTier,
      total: all.length,
      verified: all.filter((n) => n.status === "verified").length,
      stale: all.filter((n) => n.status === "stale" || n.fresh === false).length,
      offBrief: all.filter((n) => !["verified", "stale"].includes(n.status)).length,
    };
  }, [nodes]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (nodes || []).filter((n) =>
      (!tier || n.tier === tier) &&
      (!status || n.status === status) &&
      (!category || n.category === category) &&
      (!needle ||
        n.title?.toLowerCase().includes(needle) ||
        n.body?.toLowerCase().includes(needle))
    );
  }, [nodes, q, tier, status, category]);

  const toggleTier = (t) => setTier((cur) => (cur === t ? "" : t));

  return (
    <div>
      {error && <ErrorNote className="mb-3">{error}</ErrorNote>}

      {/* The reliability ladder. What sits at tier D is the backlog:
          unverified volume waiting on a human. */}
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {LADDER.map((l) => (
          <TierCard
            key={l.tier}
            {...l}
            count={stats.byTier[l.tier] || 0}
            total={stats.total}
            onClick={() => toggleTier(l.tier)}
            active={tier === l.tier}
          />
        ))}
      </div>
      <div className="mb-8">
        <TierCard
          {...UNVERIFIED}
          count={stats.byTier.D || 0}
          total={stats.total}
          onClick={() => toggleTier("D")}
          active={tier === "D"}
        />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-success" strokeWidth={2} aria-hidden="true" />
          {stats.verified} live on briefs
        </span>
        <span className="flex items-center gap-1.5">
          <RotateCw className="size-3.5 text-destructive" strokeWidth={2} aria-hidden="true" />
          {stats.stale} stale
        </span>
        <span className="flex items-center gap-1.5">
          <FileWarning className="size-3.5" strokeWidth={2} aria-hidden="true" />
          {stats.offBrief} not published (draft / pending / rejected)
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <Field label="Search" className="flex-1 min-w-52">
          {({ id }) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id={id}
                type="search"
                className="pl-8"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="title or body…"
              />
            </div>
          )}
        </Field>
        <Field label="Tier">
          {({ id }) => (
            <Select id={id} value={tier} onChange={(e) => setTier(e.target.value)}>
              <option value="">all</option>
              {TIER_KEYS.map((t) => <option key={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">all</option>
              {STATUSES.map((s) => <option key={s}>{s}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">all</option>
              {Object.entries(CATEGORIES).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {loading && !nodes ? (
        <SkeletonCards count={4} height="h-28" />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Database}
          title={stats.total === 0 ? "No claims on record." : "No claims match this filter."}
        >
          {stats.total === 0
            ? "Findings promoted through the review queue land here."
            : "Widen the tier, status or category filter."}
        </EmptyState>
      ) : (
        <>
          <Mono className="mb-3 block">
            {filtered.length} of {stats.total} claims
          </Mono>
          <div className="flex flex-col gap-3">
            {filtered.map((n) => (
              <NodeRow key={n.id} node={n} onChanged={reload} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TierCard({ tier, rung, note, count, total, onClick, active }) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  const t = TIERS[tier];
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="h-full w-full text-left">
      <Card
        className={cn(
          "h-full p-5 transition-colors",
          active ? "border-foreground ring-1 ring-foreground" : "hover:bg-accent/40"
        )}
      >
        <div className="mb-3 flex items-center justify-between">
          <TierChip tier={tier} />
          <span className="text-2xl font-semibold leading-none tracking-tight">{count}</span>
        </div>
        <div className="text-[13px] font-medium leading-tight">{rung}</div>
        <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{note}</p>
        <Progress
          value={pct}
          indicatorClassName={t.bg}
          className="mt-3 h-1"
          aria-label={`${rung}: ${pct}% of the base`}
        />
        <Mono className="mt-1.5 block text-[10px]">{pct}% of the base</Mono>
      </Card>
    </button>
  );
}

/**
 * A change to a claim's tier or status is an act of review, so it does not
 * happen on the dropdown's change event: the selection stages a pending change
 * and the row asks why. The reason is not decoration — retier_node and
 * set_node_status reject a call without one, and it is what the audit row
 * carries. See 0006_audit_and_admin_rpcs.sql.
 */
function NodeRow({ node, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [pending, setPending] = useState(null); // { kind: 'tier'|'status', value }
  const [reason, setReason] = useState("");

  function stage(kind, value) {
    setMsg(null);
    setReason("");
    setPending({ kind, value });
  }

  function cancel() {
    setPending(null);
    setReason("");
  }

  async function run(fn) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      cancel();
      await onChanged();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  }

  const commit = () =>
    run(() => api.updateNode(node.id, { [pending.kind]: pending.value }, reason.trim()));

  const stale = node.status === "stale" || node.fresh === false;

  return (
    <Card className={cn("border-l-[3px] p-5", TIER_BORDER[node.tier] || "border-l-foreground")}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-[14.5px] font-semibold leading-snug tracking-tight">{node.title}</h3>
          <Mono className="mt-1 block text-[11px]">
            #{node.id} · {node.municipality} · {CATEGORIES[node.category] || node.category} ·
            as of {node.as_of} · by {node.verified_by || "—"} ·{" "}
            {node.sources?.length ? node.sources.map((s) => s.name).join(" · ") : "no source"}
          </Mono>
        </div>
        <span
          className={cn(
            "shrink-0 font-mono text-[11px]",
            node.status === "verified" && !stale
              ? "text-success"
              : stale
              ? "text-destructive"
              : "text-muted-foreground"
          )}
        >
          {stale && node.status === "verified" ? "stale" : node.status}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
        {node.body}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3 border-t pt-4">
        <Field label="Tier">
          {({ id }) => (
            <Select
              id={id}
              value={pending?.kind === "tier" ? pending.value : node.tier}
              disabled={busy}
              onChange={(e) => stage("tier", e.target.value)}
            >
              {TIER_KEYS.map((t) => <option key={t}>{t}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Status">
          {({ id }) => (
            <Select
              id={id}
              value={pending?.kind === "status" ? pending.value : node.status}
              disabled={busy}
              onChange={(e) => stage("status", e.target.value)}
            >
              {/* The current value has to be selectable for the control to
                  show it, even when it is a pipeline status nobody may set. */}
              {(SETTABLE_STATUSES.includes(node.status)
                ? SETTABLE_STATUSES
                : [node.status, ...SETTABLE_STATUSES]
              ).map((s) => (
                <option key={s} value={s} disabled={!SETTABLE_STATUSES.includes(s)}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="ml-auto flex items-center gap-2">
          {node.status !== "rejected" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => stage("status", "rejected")}
              disabled={busy}
            >
              <Archive aria-hidden="true" /> Retire
            </Button>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-4 rounded-md border bg-muted/40 p-4">
          <Mono className="mb-2 block text-[11px]">
            {pending.kind === "tier"
              ? `tier ${node.tier} → ${pending.value}`
              : `status ${node.status} → ${pending.value}`}
          </Mono>
          <Field label="Reason (recorded in the audit log)">
            {({ id, ...aria }) => (
              <Input
                id={id}
                {...aria}
                autoFocus
                value={reason}
                disabled={busy}
                placeholder={
                  pending.kind === "tier"
                    ? "e.g. DR text re-read: applies from August, not in force yet"
                    : "e.g. superseded by the Q3 asking-price series"
                }
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reason.trim().length >= 3) commit();
                  if (e.key === "Escape") cancel();
                }}
              />
            )}
          </Field>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" onClick={commit} loading={busy} disabled={reason.trim().length < 3}>
              Save change
            </Button>
            <Button variant="outline" size="sm" onClick={cancel} disabled={busy}>
              Cancel
            </Button>
            {/* Nothing is deleted here — see 0006. */}
            {pending.value === "rejected" && (
              <Mono className="text-[11px]">
                retired, not deleted — the claim stays on the record
              </Mono>
            )}
          </div>
        </div>
      )}

      {msg && <ErrorNote className="mt-3 text-[13px]">{msg}</ErrorNote>}
    </Card>
  );
}
