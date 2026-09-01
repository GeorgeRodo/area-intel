"use client";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { FileText, Table2, Network, BookOpen } from "lucide-react";
import { api, NODE_LIMIT } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import { useMunicipality } from "@/lib/MunicipalitiesContext";
import { CoverageGrid, NodeCard, Masthead } from "@/components/intel";
import { ArticleCard, CorpusNotice } from "@/components/wiki";
import BackButton from "@/components/BackButton";
import {
  SectionHeader, ErrorNote, EmptyState, SkeletonCards, Skeleton,
} from "@/components/ui";

export default function BriefPage() {
  const { id } = useParams();
  const [category, setCategory] = useState(null);

  const { municipality, error: muniErr, loading: muniLoading } = useMunicipality(id);
  const { data: coverage, error: covErr } = useAsync(() => api.coverage(id), [id]);
  const { data: edges } = useAsync(() => api.edges(id), [id]);
  // Background reading, not coverage of this area — see the section at the
  // foot of the page. Keyed on the municipality rather than the id because the
  // query is built from its name and region.
  const { data: related } = useAsync(
    () => api.wikiRelated(municipality),
    [municipality?.id],
    { enabled: Boolean(municipality) }
  );
  // Re-runs on category change; useAsync drops out-of-order responses, so a
  // slow "all categories" load cannot overwrite a fast filtered one.
  const { data: nodes, error: nodeErr, loading: nodesLoading } = useAsync(
    () => api.nodes(id, category),
    [id, category]
  );

  const error = muniErr || covErr || nodeErr;
  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (muniLoading && !municipality) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="h-24 rounded-xl mb-8" />
        <SkeletonCards count={3} height="h-24" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }
  if (!municipality) {
    return (
      <div>
        <BackButton className="mb-5" />
        <EmptyState icon={FileText} title="No such coverage area.">
          Municipality #{id} is not in the knowledge base.
        </EmptyState>
      </div>
    );
  }

  const list = nodes ?? [];

  return (
    <div>
      <BackButton className="mb-5" />
      <Masthead muni={municipality} nodeCount={list.length} />

      <SectionHeader icon={Table2} title="Verification registry" className="mb-1 mt-8" />
      <p className="mb-3 text-xs text-muted-foreground">
        Click a cell to filter. A category with no fresh verified nodes is a gap we
        have not closed — not a fact we forgot to type.
      </p>
      <CoverageGrid coverage={coverage} onSelect={setCategory} selected={category} />

      <SectionHeader
        icon={FileText}
        title="Verified intelligence"
        className="mt-10"
        right={
          category && (
            <button
              type="button"
              onClick={() => setCategory(null)}
              className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              clear filter ×
            </button>
          )
        }
      />
      {nodesLoading && list.length === 0 ? (
        <SkeletonCards count={3} height="h-28" />
      ) : list.length === 0 ? (
        <EmptyState icon={FileText} title="No verified nodes in this category yet." />
      ) : (
        <div className="flex flex-col gap-3">
          {list.map((n) => (
            <NodeCard key={n.id} node={n} />
          ))}
        </div>
      )}

      {/* Truncation has to be visible. This page's argument is that what is
          shown is everything that has been verified for the area, so a silent
          cut would turn the strongest claim on the screen into a false one. */}
      {list.length >= NODE_LIMIT && (
        <p className="mt-3 font-mono text-[11px] text-warning">
          Showing the first {NODE_LIMIT} claims. There are more on record for
          this area than a brief can usefully render — filter by category above.
        </p>
      )}

      {edges?.length > 0 && !category && (
        <>
          <SectionHeader icon={Network} title="Cross-gap interactions" className="mt-10" />
          <ul className="flex flex-col gap-2">
            {edges.map((e, i) => (
              <li key={i} className="rounded-lg border bg-card p-4 text-sm">
                <span className="font-mono text-[11px] font-medium text-muted-foreground">
                  {e.relation}
                </span>{" "}
                — <em>{e.src.title}</em> → <em>{e.dst.title}</em>
                {e.note && <div className="mt-1 text-xs text-muted-foreground">{e.note}</div>}
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Last on the page, and deliberately so.

          Everything above is the verified layer: tiered, dated, sourced,
          promoted by a named reviewer. This is the upstream corpus, and the
          ordering is the argument — a reader reaches the team's working notes
          only after they have seen what has actually been established for this
          area, and the notice says which is which.

          Nothing here is filtered to the municipality in any strong sense.
          Most of the corpus is national (DL 108/2026, AL licensing, expansive
          clay), so this is a topical match on the area's name and region, and
          it is labelled as background rather than as coverage. An area with
          nothing here is worth seeing: it means the region has not been
          written up. */}
      {!category && related?.length > 0 && (
        <>
          <SectionHeader
            icon={BookOpen}
            title="Background from the knowledge base"
            className="mt-10"
            right={
              <Link
                href="/knowledge"
                className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              >
                browse all →
              </Link>
            }
          />
          <CorpusNotice className="mb-3" />
          <div className="flex flex-col gap-3">
            {related.map((a) => (
              <ArticleCard key={a.path} article={a} snippet={a.snippet} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
