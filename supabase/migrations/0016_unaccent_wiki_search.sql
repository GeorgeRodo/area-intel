-- 0016_unaccent_wiki_search.sql
--
-- Makes wiki search fold diacritics, so `licenca` finds `licença`.
--
-- THE BUG
--
-- 0007 chose the 'simple' text search configuration deliberately, and that
-- reasoning still holds: these articles mix English prose with Portuguese legal
-- terms in one sentence, and a language stemmer mangles whichever half it was
-- not built for. But 'simple' also does not fold accents, and that half of the
-- decision was never examined. Measured against the pilot project's 108
-- articles before this migration:
--
--   query          wiki_search hits, before   wiki_search hits, after
--   licença                             7                         7
--   licenca                             0                         7
--   câmara                             15                        15
--   camara                              0                        15
--   construção                          3                         3
--   construcao                          0                         3
--
-- Both columns measured against the pilot project on 2026-09-02, by
-- supabase/apply_migration.py's own before/after report. An earlier draft of
-- this comment printed 5 for licença and câmara: that was a probe run with
-- p_limit=5 reading its own ceiling back, not the corpus.
--
-- Zero results, with no indication that the query was the problem. The product
-- is sold to foreign buyers of Portuguese property, typing on keyboards that
-- mostly cannot produce ç or â, so the unaccented spelling is the common case
-- and it was the one that returned nothing.
--
-- Accent folding is a different axis from stemming: unaccent is a filtering
-- dictionary that hands its output on to the next dictionary, so it composes
-- with 'simple' without reopening 0007's decision. Nothing here stems.

-- ---------- extension ----------
--
-- Supabase keeps extensions in `extensions`. `if not exists` is a no-op when
-- the extension is already installed, wherever it lives, so this is safe on a
-- project that already has it — the wrapper below pins a search_path that
-- resolves the dictionary in either schema rather than assuming this one won.
create extension if not exists unaccent with schema extensions;

-- ---------- immutable wrapper ----------
--
-- Same shape of problem as wiki_tags_text in 0007, and worth being precise
-- about why this one is honest rather than a convenient lie.
--
-- unaccent(text) is STABLE: with no dictionary named, it resolves one through
-- the current default text search configuration, which is a run-time setting.
-- unaccent(regdictionary, text) is declared IMMUTABLE by the extension itself,
-- because naming the dictionary removes exactly that dependency. This wrapper
-- calls the two-argument form, so it claims no more immutability than upstream
-- already does — it is not `unaccent(text)` relabelled.
--
-- The residual caveat, stated rather than buried: the rules come from
-- unaccent.rules on disk. Editing that file changes past output and would
-- require rebuilding the generated column below. Nobody edits it, PostgreSQL
-- accepts the same trade in its own IMMUTABLE declaration, and a generated
-- column is impossible without it.
create or replace function public.wiki_unaccent(p_text text)
returns text
language sql
immutable
parallel safe
set search_path = extensions, public
as $$
  select unaccent('unaccent'::regdictionary, coalesce(p_text, ''))
$$;

comment on function public.wiki_unaccent(text) is
  'Diacritic-folding helper for the wiki_articles.fts generated column and '
  'wiki_search. Wraps the IMMUTABLE two-argument unaccent(regdictionary, text).';

-- ---------- rebuild the generated column ----------
--
-- A generation expression cannot be altered in place before PostgreSQL 18, so
-- the column is dropped and re-added. Dropping it takes idx_wiki_fts with it;
-- both are recreated below. This rewrites every row, which at the corpus's
-- current size (108 articles) is immediate — revisit if the vault reaches the
-- tens of thousands, where this wants a concurrent index build instead.
--
-- Weights are unchanged from 0007: title A, tags B, body C.
alter table wiki_articles drop column if exists fts;

alter table wiki_articles
  add column fts tsvector generated always as (
    setweight(to_tsvector('simple', public.wiki_unaccent(coalesce(title, ''))), 'A') ||
    setweight(to_tsvector('simple', public.wiki_unaccent(public.wiki_tags_text(tags))), 'B') ||
    setweight(to_tsvector('simple', public.wiki_unaccent(coalesce(body, ''))), 'C')
  ) stored;

create index if not exists idx_wiki_fts on wiki_articles using gin (fts);

-- ---------- search ----------
--
-- The query side has to fold too, or the stored lexemes and the query lexemes
-- stop meeting: unaccenting only the document would make `licença` the spelling
-- that fails. Folding both means either spelling finds both.
--
-- ts_headline now runs over the unaccented body, and that is a real trade made
-- with open eyes. The alternative — headline over the original text — keeps
-- diacritics in the snippet, but when the query lexemes do not appear in the
-- text it was handed, ts_headline silently falls back to the opening words of
-- the article instead of the passage that matched. That is the failure this
-- migration exists to remove, one layer further out: a result whose snippet
-- cannot show why it is a result. Correct fragment selection and correct
-- highlighting are worth more than the cedillas in a two-line preview.
--
-- To reverse that choice, change wiki_unaccent(w.body) back to w.body on the
-- ts_headline line alone; nothing else depends on it.
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
  with q as (
    select websearch_to_tsquery('simple', public.wiki_unaccent(p_query)) as query
  )
  select w.path, w.title, w.tags, w.wiki_verified, w.updated_in_wiki,
         ts_headline('simple', public.wiki_unaccent(w.body), q.query,
                     'MaxWords=40, MinWords=15, ShortWord=3, MaxFragments=2, '
                     'FragmentDelimiter=" … "'),
         ts_rank(w.fts, q.query)
  from wiki_articles w, q
  where w.fts @@ q.query
  order by ts_rank(w.fts, q.query) desc, w.updated_in_wiki desc nulls last
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

comment on function public.wiki_search(text, integer) is
  'Ranked wiki search with highlighted snippets, accent-insensitive since 0016. '
  'security invoker: RLS on wiki_articles still applies, so an unauthenticated '
  'caller gets nothing.';

-- ---------- grants ----------
-- wiki_search keeps the grant 0007 gave it; re-stated because `create or
-- replace` on an existing function preserves grants but a dropped-and-recreated
-- one would not, and this file should be safe to run either way.
-- wiki_unaccent relies on the default PUBLIC execute, as wiki_tags_text does:
-- it is a pure string function over its argument and reads nothing.
grant execute on function public.wiki_search(text, integer) to authenticated;

-- ---------- verification ----------
--
-- Run after applying. The first two must return the same non-zero count, and
-- before this migration the second returned 0:
--
--   select count(*) from wiki_search('licença', 100);
--   select count(*) from wiki_search('licenca', 100);
--   select count(*) from wiki_search('camara', 100);
--
-- And confirm the generated column really was rebuilt rather than left empty,
-- which is the one plausible failure worth checking for directly:
--
--   select count(*) from wiki_articles where fts is null or fts = ''::tsvector;
--   -- expected: 0
