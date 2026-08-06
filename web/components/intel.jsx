import { CATEGORIES, TIERS, TIER_BORDER, TIER_TOP_BORDER } from "@/lib/labels";
import { Card, Mono } from "@/components/ui";
import { cn } from "@/lib/utils";

export function TierChip({ tier, withDesc = false }) {
  const t = TIERS[tier] || TIERS.D;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wide",
        t.bg,
        t.fg
      )}
      title={`Tier ${t.label} — ${t.desc}`}
    >
      {t.label}
      {withDesc && <span className="opacity-75">· {t.desc}</span>}
    </span>
  );
}

/* The verification registry. Verified cells carry a tier-weighted top rule;
   UNKNOWN cells are hatched — a missing stamp, not an empty box. */
export function CoverageGrid({ coverage, onSelect, selected }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border md:grid-cols-3 lg:grid-cols-4">
      {Object.entries(CATEGORIES).map(([key, label]) => {
        const c = coverage?.[key];
        const known = c && c.verified_fresh > 0;
        const active = selected === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(active ? null : key)}
            className={cn(
              "relative border-t-2 p-3 pt-3.5 text-left transition-colors",
              known
                ? TIER_TOP_BORDER[c.best_tier] || "border-t-foreground"
                : "border-t-transparent hatch",
              active
                ? "bg-accent"
                : known
                ? "bg-card hover:bg-accent/60"
                : "hover:brightness-[0.98] dark:hover:brightness-125"
            )}
          >
            <div className="mb-2 text-[13px] font-medium leading-tight">{label}</div>
            {known ? (
              <div className="flex flex-wrap items-center gap-2">
                <TierChip tier={c.best_tier} />
                <Mono className="text-[11px]">
                  {c.verified_fresh} fresh · {c.latest_as_of}
                </Mono>
              </div>
            ) : (
              <span className="font-mono text-[11px] font-semibold tracking-wide text-warning">
                UNKNOWN — NOT YET VERIFIED
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function NodeCard({ node }) {
  // `fresh` is computed by the view and can be absent on rows that predate it;
  // absent must not read as stale, so this tests for an explicit false — the
  // same rule the admin knowledge-base panel applies.
  const stale = node.status === "stale" || node.fresh === false;
  return (
    <Card className={cn("border-l-[3px] p-5", TIER_BORDER[node.tier] || "border-l-foreground")}>
      <div className="mb-2 flex items-center gap-2">
        <TierChip tier={node.tier} withDesc />
        {stale ? (
          <span className="font-mono text-[11px] font-medium text-destructive">
            STALE — REFRESH QUEUED
          </span>
        ) : (
          <span className="font-mono text-[11px] text-success">fresh</span>
        )}
      </div>
      <h3 className="mb-1.5 text-[15px] font-semibold leading-snug tracking-tight">
        {node.title}
      </h3>
      <p className="mb-3 text-sm leading-relaxed text-muted-foreground">{node.body}</p>
      <Mono className="text-[11px]">
        [{CATEGORIES[node.category] || node.category}] as of {node.as_of} · verified by{" "}
        {node.verified_by || "—"} · source:{" "}
        {node.sources?.length ? node.sources.map((s) => s.name).join(" · ") : "none"}
      </Mono>
    </Card>
  );
}

/* Dossier masthead for a municipality brief */
export function Masthead({ muni, nodeCount }) {
  return (
    <header className="mb-8 border-b pb-5">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Area intelligence brief
          </div>
          <h1 className="text-4xl font-semibold leading-none tracking-tight">{muni.name}</h1>
        </div>
        <dl className="text-right font-mono text-[11px] leading-relaxed text-muted-foreground">
          <div>
            {muni.district} · {muni.region}
          </div>
          <div>{nodeCount} verified claims on record</div>
          <div>every claim: tier · source · as-of date</div>
        </dl>
      </div>
      {muni.notes && (
        <p className="mt-4 max-w-2xl text-sm text-muted-foreground">{muni.notes}</p>
      )}
    </header>
  );
}
