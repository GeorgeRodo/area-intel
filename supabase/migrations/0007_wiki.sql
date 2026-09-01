-- 0007_wiki.sql
--
-- Mirrors the team's llm-wiki (the pt-buyers-kb Obsidian vault) into Postgres,
-- so the compiled research the team actually writes is reachable from both
-- consumers: the Next.js dashboard (which only ever talks to Supabase) and the
-- worker's agent (which until now could only read the vault off the local
-- filesystem via WIKI_PATH, and so only worked on the machine running it).
--
-- Additive only. No existing table, policy, view or function is touched.
--
-- WHAT THIS IS NOT
--
-- A wiki article is not a verified claim. knowledge_nodes remains the sole
-- authority for anything shown to a user as fact, reached only through
-- promote_finding() and carrying a tier, an as_of and a reviewer. This table is
-- the upstream corpus: what the team knows, not what the team has verified.
-- Hence wiki_verified below is deliberately NOT named `verified` - it is the
-- vault's own frontmatter flag, on a different axis from the A-D ladder, and
-- must never be mapped onto a tier automatically.
--
-- Writes are service-role only (the sync job in kb/sync_wiki.py). There is no
-- insert/update/delete policy for any client role, the same posture 0002 takes
-- with knowledge_nodes: content arrives through one auditable path or not at
-- all. Reads require a session, matching 0005.

-- ---------- immutable helper for the generated column ----------
--
-- array_to_string(anyarray, text) is STABLE, not IMMUTABLE — conservatively so,
-- because for an arbitrary element type the output function need not be
-- immutable. A generated column requires a fully immutable expression, so
-- putting it directly in `fts` below fails at create time with
--
--   ERROR: 42P17: generation expression is not immutable
--
-- Narrowing the signature to text[] is what makes the promise honest: text's
-- output function *is* immutable, so for this one concrete type the result
-- genuinely depends on nothing but the input. This is the standard workaround
-- and it is safe precisely because it is not generic.
--
-- Deliberately not solved with array_to_tsvector(tags), which is immutable and
-- looks like the tidier answer. It takes array elements as finished lexemes
-- without passing them through a parser, so 'phase-4' would be stored as one
-- lexeme while websearch_to_tsquery('simple', 'phase-4') splits it — and the
-- tag would stop matching its own search. Going through to_tsvector keeps both
-- sides using the same tokenizer.
create or replace function public.wiki_tags_text(p_tags text[])
returns text language sql immutable parallel safe as $$
  select coalesce(array_to_string(p_tags, ' '), '')
$$;

create table wiki_articles (
  -- Vault-relative posix path, e.g. '03-domains/legal/dl-10-2024-simplex.md'.
  -- Natural key: it is what a wikilink resolves to and what the agent already
  -- cites in findings.source_url as 'wiki:<path>', so findings written before
  -- this migration point at rows in it without a backfill.
  path            text primary key,
  title           text not null,
  doc_type        text,                              -- frontmatter `type`: entity / concept / ...
  tags            text[] not null default '{}',
  wiki_status     text,                              -- frontmatter `status`: draft / ...
  brand           text,                              -- shared / homeos / inspectos
  wiki_verified   boolean not null default false,    -- see note above: NOT the tier ladder
  wiki_sources    text[] not null default '{}',      -- frontmatter `sources`: [src-...]
  body            text not null,                     -- markdown, frontmatter stripped
  content_hash    text not null,                     -- sha256 of the whole file, incl. frontmatter
  updated_in_wiki date,                              -- frontmatter `updated`
  commit_sha      text,                              -- wiki commit this row was synced from
  synced_at       timestamptz not null default now(),

  -- 'simple' rather than 'english' or 'portuguese' on purpose: these articles
  -- mix English prose with Portuguese legal terms (alvenarias de enchimento,
  -- termos de responsabilidade, Câmara Municipal) in the same sentence, and a
  -- language-specific stemmer mangles whichever half it was not built for.
  -- Unstemmed exact matching is the honest default here; revisit only with
  -- pgvector, which solves the recall problem properly.
  fts tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', public.wiki_tags_text(tags)), 'B') ||
    setweight(to_tsvector('simple', coalesce(body, '')), 'C')
  ) stored
);

comment on table wiki_articles is
  'Mirror of the llm-wiki vault, synced by kb/sync_wiki.py. Upstream corpus, '
  'not verified knowledge: never render these as tiered claims. Service role '
  'writes only.';

create index idx_wiki_fts on wiki_articles using gin (fts);
create index idx_wiki_tags on wiki_articles using gin (tags);
create index idx_wiki_updated on wiki_articles (updated_in_wiki desc nulls last);

-- The vault's [[wikilinks]], resolved to paths where the target exists. This is
-- the same graph idea as `edges` over knowledge_nodes, kept in its own table
-- because it is upstream structure the team authored, not a curated relation.
--
-- dst_path is null for a dangling link (target written but never created).
-- Those rows are kept rather than dropped: an unresolved link is a real signal
-- about where the vault is thin, and the dashboard can surface it.
create table wiki_links (
  src_path text not null references wiki_articles(path) on delete cascade,
  dst_slug text not null,                             -- the [[slug]] as written
  dst_path text references wiki_articles(path) on delete set null,
  primary key (src_path, dst_slug)
);

create index idx_wiki_links_dst on wiki_links (dst_path);

-- ---------- RLS ----------

alter table wiki_articles enable row level security;
alter table wiki_links enable row level security;

-- Any signed-in account reads the wiki, admin or user. It is background
-- material, not the gated product surface - what a `user` role must not see is
-- the review queue and unpromoted claims, which live elsewhere and stay closed.
create policy wiki_read on wiki_articles for select
  using (auth.uid() is not null);

create policy wiki_links_read on wiki_links for select
  using (auth.uid() is not null);

-- ---------- search ----------

-- Ranked search with a highlighted snippet, so the frontend does not have to
-- build tsquery strings by hand and the ranking stays one definition in one
-- place. websearch_to_tsquery takes what a person types (quoted phrases, OR,
-- leading -) without throwing on punctuation the way to_tsquery does.
create or replace function public.wiki_search(p_query text, p_limit integer default 20)
returns table (
  path text,
  title text,
  tags text[],
  wiki_verified boolean,
  updated_in_wiki date,
  snippet text,
  rank real
) language sql stable security invoker set search_path = public as $$
  with q as (select websearch_to_tsquery('simple', p_query) as query)
  select w.path, w.title, w.tags, w.wiki_verified, w.updated_in_wiki,
         ts_headline('simple', w.body, q.query,
                     'MaxWords=40, MinWords=15, ShortWord=3, MaxFragments=2, '
                     'FragmentDelimiter=" … "'),
         ts_rank(w.fts, q.query)
  from wiki_articles w, q
  where w.fts @@ q.query
  order by ts_rank(w.fts, q.query) desc, w.updated_in_wiki desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.wiki_search(text, integer) is
  'Ranked wiki search with highlighted snippets. security invoker: RLS on '
  'wiki_articles still applies, so an unauthenticated caller gets nothing.';

-- ---------- grants ----------
-- RLS decides what comes back; these only open the door far enough for the
-- policies above to be the thing that says no. anon is granted nothing:
-- 0005 revoked its access outright and this table joins that posture.

grant select on wiki_articles, wiki_links to authenticated;
grant execute on function public.wiki_search(text, integer) to authenticated;
