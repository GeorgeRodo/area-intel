"use client";
import Link from "next/link";
import { BookOpen } from "lucide-react";

import { Badge, Card, Mono } from "@/components/ui";
import { cn } from "@/lib/utils";

/**
 * Rendering for the wiki corpus (0007: wiki_articles / wiki_links).
 *
 * THE ONE RULE THIS FILE EXISTS TO KEEP
 *
 * A wiki article is not a verified claim. 0007 says so at the top of the
 * migration and it is the distinction the whole product rests on:
 * knowledge_nodes carries a tier, an as-of date, a source and a reviewer, and
 * is the only thing that may be presented to a reader as fact. This is the
 * upstream corpus — what the team knows, not what the team has verified.
 *
 * So nothing here renders a TierChip, borrows the tier border colours from
 * intel.jsx, or maps `wiki_verified` onto A-D. `wiki_verified` is the vault's
 * own frontmatter flag on a different axis, and it is deliberately shown as a
 * quiet, differently-shaped label so that no reader — and no future edit —
 * slides the two together.
 */

/* ------------------------------------------------------------------ *
 * Article identity
 * ------------------------------------------------------------------ */

/**
 * `03-domains/legal/dl-108-2026.md` -> `/knowledge/03-domains/legal/dl-108-2026.md`
 *
 * The `.md` stays in the URL. It is part of the primary key in wiki_articles,
 * it is what a wikilink resolves to, and it is what the agent already writes
 * into findings.source_url as `wiki:<path>` — so keeping the round-trip exact
 * means a citation can become a link with no lookup table in between.
 */
export function articleHref(path) {
  return `/knowledge/${path.split("/").map(encodeURIComponent).join("/")}`;
}

/** The folder an article lives in, which is how the vault expresses topic. */
export function articleSection(path) {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "(root)";
}

/* ------------------------------------------------------------------ *
 * Corpus notice
 * ------------------------------------------------------------------ */

/**
 * Shown wherever wiki content appears next to, or instead of, verified claims.
 * Deliberately not dismissible: the moment this surface starts looking like the
 * verification registry is the moment the product's central claim stops being
 * true, and that is a permanent risk, not a first-visit one.
 */
export function CorpusNotice({ className }) {
  return (
    <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
      <span className="font-medium text-foreground">Research corpus, not verified claims.</span>{" "}
      These are the team&apos;s compiled notes — the working basis for research, and
      the starting point for a claim rather than the claim itself. Nothing here
      carries a reliability tier, a source of record or a freshness deadline. For
      what has actually been verified for an area, see its Area Brief.
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Metadata
 * ------------------------------------------------------------------ */

/**
 * `wiki_verified` is the vault's frontmatter flag: the team's own marker that
 * an article has been reviewed internally. Rendered as a neutral outline badge
 * — never in the tier palette, never as a green "verified" tick — because a
 * reader who reads it as tier A has been misled by the UI, not by the data.
 */
export function ArticleMeta({ article, className }) {
  const { doc_type, wiki_status, brand, wiki_verified, updated_in_wiki, tags } = article;
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-2", className)}>
      {doc_type && <Badge variant="secondary">{doc_type}</Badge>}
      {wiki_status && <Mono className="text-[11px]">status: {wiki_status}</Mono>}
      {brand && brand !== "shared" && <Mono className="text-[11px]">{brand}</Mono>}
      <Mono className="text-[11px]">
        {wiki_verified ? "team-reviewed" : "unreviewed"}
      </Mono>
      {updated_in_wiki && <Mono className="text-[11px]">updated {updated_in_wiki}</Mono>}
      {tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.slice(0, 6).map((t) => (
            <Mono key={t} className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
              {t}
            </Mono>
          ))}
          {tags.length > 6 && (
            <Mono className="text-[10px]">+{tags.length - 6}</Mono>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * List row
 * ------------------------------------------------------------------ */

export function ArticleCard({ article, snippet }) {
  return (
    <Card className="p-4 transition-colors hover:border-foreground/25">
      <Link href={articleHref(article.path)} className="block">
        <h3 className="text-[15px] font-semibold leading-snug tracking-tight">
          {article.title}
        </h3>
        <Mono className="mt-0.5 block text-[11px]">{article.path}</Mono>
      </Link>

      {/* Comes from ts_headline() server-side, which wraps hits in <b>. Rendered
          as text, never as HTML: it is the one string on this screen built by
          concatenation around user input, so treating it as markup would be
          handing search a way to inject into the page. The tags are stripped
          instead — losing the emphasis is a fair price. */}
      {snippet && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {snippet.replace(/<\/?b>/g, "")}
        </p>
      )}

      <ArticleMeta article={article} className="mt-3" />
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Section heading for the corpus surfaces
 * ------------------------------------------------------------------ */

export function CorpusIcon(props) {
  return <BookOpen {...props} />;
}
