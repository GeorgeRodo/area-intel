"use client";
import Link from "next/link";
import { useParams } from "next/navigation";
import { BookOpen, FileQuestion } from "lucide-react";

import { api } from "@/lib/api";
import { useAsync } from "@/lib/useAsync";
import {
  ErrorNote, EmptyState, SectionHeader, Skeleton, Mono, Card,
} from "@/components/ui";
import BackButton from "@/components/BackButton";
import { ArticleMeta, CorpusNotice, articleHref } from "@/components/wiki";
// Separate module on purpose: it carries react-markdown, and only this page
// renders a body. See the note at the top of wiki-body.jsx.
import { ArticleBody } from "@/components/wiki-body";

/**
 * One article.
 *
 * Catch-all route because the identifier is a vault-relative path with slashes
 * in it — 03-domains/legal/dl-108-2026.md — and that path is the primary key in
 * wiki_articles, not a slug we are free to reshape. Keeping the URL identical
 * to the key is what lets a `wiki:<path>` citation on a finding become a link
 * with nothing in between.
 */
export default function ArticlePage() {
  const params = useParams();

  // Next gives the catch-all back as an array of already-decoded segments.
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const path = segments.filter(Boolean).join("/");

  const { data: article, error, loading } = useAsync(() => api.wikiArticle(path), [path]);

  if (error) return <ErrorNote>{error}</ErrorNote>;

  if (loading && !article) {
    return (
      <div role="status" aria-label="Loading">
        <Skeleton className="mb-4 h-8 w-2/3 rounded-md" />
        <Skeleton className="mb-8 h-4 w-1/3 rounded-md" />
        <Skeleton className="h-64 rounded-xl" />
        <span className="sr-only">Loading…</span>
      </div>
    );
  }

  if (!article) {
    return (
      <div>
        <BackButton className="mb-5" fallbackHref="/knowledge" />
        <EmptyState icon={FileQuestion} title="No such article.">
          <Mono>{path}</Mono> is not in the corpus. It may have been renamed or
          deleted in the vault — the sync removes rows for files that no longer
          exist, so a stale link ends up here rather than serving a ghost.
        </EmptyState>
      </div>
    );
  }

  // Dangling links are kept by 0007 on purpose: they say where the vault is
  // thin. Surfacing the count at the foot of the article makes that visible to
  // the person best placed to fix it.
  const outgoing = article.links || [];
  const resolved = outgoing.filter((l) => l.dst_path);
  const dangling = outgoing.filter((l) => !l.dst_path);

  return (
    <div>
      <BackButton className="mb-5" fallbackHref="/knowledge" />

      <header className="mb-6">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight">
          {article.title}
        </h1>
        <Mono className="mt-1 block text-[11px]">{article.path}</Mono>
        <ArticleMeta article={article} className="mt-4" />
      </header>

      <Card className="mb-6 border-dashed p-4">
        <CorpusNotice />
      </Card>

      <ArticleBody body={article.body} links={outgoing} />

      {outgoing.length > 0 && (
        <div className="mt-10 border-t pt-6">
          <SectionHeader icon={BookOpen} title="Linked from this article" className="mb-3" />

          {resolved.length > 0 && (
            <ul className="mb-4 flex flex-col gap-1.5">
              {resolved.map((l) => (
                <li key={l.dst_slug}>
                  <Link
                    href={articleHref(l.dst_path)}
                    className="text-sm font-medium underline underline-offset-2"
                  >
                    {l.dst_slug}
                  </Link>
                  <Mono className="ml-2 text-[11px]">{l.dst_path}</Mono>
                </li>
              ))}
            </ul>
          )}

          {dangling.length > 0 && (
            <div>
              <Mono className="text-[11px] text-warning">
                {dangling.length} link(s) point at articles that do not exist yet
              </Mono>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {dangling.map((l) => (
                  <Mono
                    key={l.dst_slug}
                    className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {l.dst_slug}
                  </Mono>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
