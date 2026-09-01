"use client";
import Link from "next/link";
import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink } from "lucide-react";

import { articleHref } from "@/components/wiki";

/**
 * The article body renderer, kept in its own module for one reason: it pulls in
 * react-markdown and remark-gfm, which are ~50 kB of the client bundle.
 *
 * Only the article reader needs them. The Area Brief and the knowledge index
 * render titles, tags and snippets — so when this lived alongside ArticleCard
 * in wiki.jsx, every brief a buyer opened paid for a markdown parser it never
 * called. Import from here, not from wiki.jsx, and keep it that way.
 */

/* ------------------------------------------------------------------ *
 * Body
 * ------------------------------------------------------------------ */

// [[slug]] and [[slug|alias]], optionally with a #heading. Mirrors LINK_RE in
// kb/wiki_parse.py — the two must agree, or the reader will linkify something
// the sync never recorded an edge for.
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;

// Marker href for a wikilink whose target does not exist. 0007 keeps those
// rows on purpose — an unresolved link is a real signal about where the vault
// is thin — so the reader shows them rather than quietly dropping the text.
const DANGLING = "wiki-dangling:";

/**
 * Rewrite Obsidian wikilinks into ordinary markdown links before parsing.
 *
 * Resolution comes from the wiki_links rows, not from guessing at the path:
 * the vault writes [[dl-108-2026]] and the file is at
 * 03-domains/legal/dl-108-2026.md, so only the sync knows the mapping.
 */
function linkifyWikilinks(body, linkMap) {
  return body.replace(WIKILINK_RE, (_m, slug, alias) => {
    const key = slug.trim();
    const label = (alias || key).trim();
    const target = linkMap.get(key);
    return target
      ? `[${label}](${articleHref(target)})`
      : `[${label}](${DANGLING}${encodeURIComponent(key)})`;
  });
}

function MarkdownLink({ href = "", children }) {
  if (href.startsWith(DANGLING)) {
    const slug = decodeURIComponent(href.slice(DANGLING.length));
    return (
      <span
        className="cursor-help border-b border-dotted border-muted-foreground/60 text-muted-foreground"
        title={`Not yet written in the wiki: [[${slug}]]`}
      >
        {children}
      </span>
    );
  }

  if (href.startsWith("/")) {
    return (
      <Link href={href} className="font-medium underline underline-offset-2">
        {children}
      </Link>
    );
  }

  // Anything else is off-site. noreferrer alongside noopener because these
  // URLs come from the vault and the referrer would leak which brief a reader
  // was on to whoever the team happened to cite.
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium underline underline-offset-2"
    >
      {children}
      <ExternalLink aria-hidden="true" className="ml-0.5 inline size-3 align-baseline" />
    </a>
  );
}

/**
 * The article body.
 *
 * react-markdown does not render raw HTML unless you add rehype-raw, and it is
 * deliberately not added. These bodies are team-authored, but they arrive over
 * a sync job from a separate repository, and "trusted enough to read" is not
 * the same as "trusted enough to execute in the dashboard's origin" — where the
 * reader is holding a Supabase session.
 */
export function ArticleBody({ body, links = [] }) {
  const source = useMemo(() => {
    const map = new Map(
      links.filter((l) => l.dst_path).map((l) => [l.dst_slug, l.dst_path])
    );
    return linkifyWikilinks(body || "", map);
  }, [body, links]);

  return (
    <div className="max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: MarkdownLink,
          h1: ({ children }) => (
            <h2 className="mb-3 mt-8 text-lg font-semibold tracking-tight first:mt-0">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mb-2 mt-7 text-base font-semibold tracking-tight first:mt-0">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="mb-2 mt-6 text-sm font-semibold tracking-tight first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="mb-3 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="mb-3 list-disc space-y-1.5 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1.5 pl-5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-2 pl-4 text-muted-foreground">{children}</blockquote>
          ),
          code: ({ inline, children }) =>
            inline ? (
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px]">{children}</code>
            ) : (
              <code className="font-mono text-[12px]">{children}</code>
            ),
          pre: ({ children }) => (
            // Wide code must scroll inside its own box; the page body must not.
            <pre className="mb-3 overflow-x-auto rounded-md bg-muted p-3">{children}</pre>
          ),
          // Vault tables are wide (comparison matrices with Portuguese terms in
          // full). Same rule as code: scroll the table, never the page.
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b px-2 py-1.5 font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
          hr: () => <hr className="my-6" />,
        }}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
