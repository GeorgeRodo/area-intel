"use client";
import { useMemo, useState } from "react";
import { BookOpen, Search } from "lucide-react";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import {
  PageHeader, SectionHeader, Input, Field, ErrorNote, EmptyState,
  SkeletonCards, Mono,
} from "@/components/ui";
import { ArticleCard, CorpusNotice, articleSection } from "@/components/wiki";

/**
 * The knowledge base index.
 *
 * Two modes in one screen, because they answer different questions and the
 * corpus is small enough that both fit. With an empty box you get the whole
 * vault grouped by folder, which is how the team already thinks about it —
 * 03-domains/legal is a place, not a tag. Type, and it switches to ranked
 * search over wiki_search(), which is the only way to find a paragraph buried
 * in one of the longer dossiers.
 */
export default function KnowledgePage() {
  const [query, setQuery] = useState("");
  const term = query.trim();

  const { data: articles, error, loading } = useAsync(() => api.wikiArticles(), []);

  // useAsync drops out-of-order responses, so a slow early query cannot
  // overwrite the results of a later, narrower one.
  const {
    data: hits, error: searchErr, loading: searching,
  } = useAsync(() => api.wikiSearch(term), [term], { enabled: Boolean(term) });

  // Grouped by the folder the article lives in. Sorted by path already (the
  // query orders by it), so the sections come out in vault order rather than
  // whatever the map happened to iterate.
  const sections = useMemo(() => {
    const out = new Map();
    for (const a of articles || []) {
      const key = articleSection(a.path);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(a);
    }
    return [...out.entries()];
  }, [articles]);

  if (error) return <ErrorNote>{error}</ErrorNote>;

  return (
    <div>
      <PageHeader
        eyebrow="Knowledge base"
        title="Research corpus"
        description="The team's compiled notes, synced from the pt-buyers-kb vault. This is what the research agent reads before it looks anything up."
      />

      <CorpusNotice className="mb-6 max-w-3xl" />

      <Field label="Search">
        {({ id, ...aria }) => (
          <div className="relative max-w-xl">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={id}
              {...aria}
              type="search"
              className="pl-9"
              placeholder="e.g. alojamento local, expansive clay, IMT"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}
      </Field>

      {term ? (
        <SearchResults term={term} hits={hits} error={searchErr} loading={searching} />
      ) : (
        <Browse sections={sections} loading={loading} count={articles?.length ?? 0} />
      )}
    </div>
  );
}

function SearchResults({ term, hits, error, loading }) {
  if (error) return <ErrorNote className="mt-6">{error}</ErrorNote>;
  if (loading && !hits) return <SkeletonCards count={3} height="h-28" className="mt-6" />;

  if (!hits?.length) {
    return (
      <EmptyState icon={Search} title={`Nothing in the corpus matches “${term}”.`} className="mt-6">
        Search covers titles, tags and article bodies. An absence here is worth
        noticing — it means the team has not written this up yet.
      </EmptyState>
    );
  }

  return (
    <div className="mt-6">
      <SectionHeader
        icon={Search}
        title="Results"
        right={<Mono className="text-[11px]">{hits.length} article(s), best match first</Mono>}
        className="mb-3"
      />
      <div className="flex flex-col gap-3">
        {hits.map((h) => (
          <ArticleCard key={h.path} article={h} snippet={h.snippet} />
        ))}
      </div>
    </div>
  );
}

function Browse({ sections, loading, count }) {
  if (loading && !sections.length) {
    return <SkeletonCards count={4} height="h-24" className="mt-6" />;
  }

  if (!sections.length) {
    return (
      <EmptyState icon={BookOpen} title="The corpus is empty." className="mt-6">
        Nothing has been synced yet. Apply <Mono>0007_wiki.sql</Mono> and run{" "}
        <Mono>python -m kb.sync_wiki</Mono> against the vault to populate it.
      </EmptyState>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-8">
      <Mono className="text-[11px]">{count} article(s) in the corpus</Mono>
      {sections.map(([section, list]) => (
        <section key={section}>
          <SectionHeader
            icon={BookOpen}
            title={section}
            right={<Mono className="text-[11px]">{list.length}</Mono>}
            className="mb-3"
          />
          <div className="flex flex-col gap-3">
            {list.map((a) => (
              <ArticleCard key={a.path} article={a} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
