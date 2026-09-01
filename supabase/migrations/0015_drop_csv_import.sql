-- 0015 — remove the ADENE CSV import from knowledge_nodes.
--
-- DESTRUCTIVE. This deletes 470,286 rows and 290 municipalities. Read the
-- guard at the top before running it; it is what makes re-running safe.
--
-- WHY THIS IS NOT A UI PROBLEM
--
-- The import loaded one knowledge_nodes row per building element from an
-- energy-certificate extract:
--
--   title  Data Point #133766: 34936010 (Grandola)
--   body   Env_ID_Certificado: 34936010 Tipo_Elemento: Pavimentos
--          Solucao_implementada: Pavimento com isolamento térmico pelo interior…
--   tier C · status verified · verified_by csv_import · category physical
--
-- Every one of the 470,286 carries status = 'verified' and no citation at all
-- (sources and citations are both empty tables). That is the problem, and it
-- is not cosmetic.
--
-- This schema spends a lot of effort making 'verified' mean one specific
-- thing: a named reviewer promoted a claim against a primary source, on a
-- date, with a freshness deadline. 0002 gives no client role insert, update or
-- delete on knowledge_nodes precisely so that promote_finding() is the only
-- door in. A bulk load that writes 'verified' directly does not just bypass
-- that door — it makes the word mean nothing on 470,000 rows, and the product
-- has no other claim to make.
--
-- Two smaller consequences, both fixed by the same delete:
--
--   * Every row is category = 'physical'. regulatory, tax, market, liquidity,
--     infrastructure and esg are all zero, so the coverage grid reads as one
--     enormous column and six permanent gaps.
--   * municipalities came in flattened: all 290 rows have district = region =
--     'Portugal'. Grandola's real region, 'Alentejo Litoral', is gone, which
--     also breaks the Area Brief's related-articles lookup, since that query
--     is built from name + region + district.
--
-- WHAT REPLACES IT
--
-- kb/seed_grandola.py, which writes a small number of real claims with real
-- sources, real tiers and a real reviewer — and deliberately leaves categories
-- empty where nothing has been verified, because on this dashboard absence is
-- signal rather than a bug.
--
-- The EPC data itself is worth having. It just is not a set of claims: the
-- honest shape is its own table, or an aggregate promoted through the normal
-- review path ("X% of Grandola stock has floor insulation", tier B, sourced to
-- ADENE, verified by a person). Neither is this migration's job.

begin;

-- ---------- guard ----------
--
-- Refuses to run if knowledge_nodes holds anything that is NOT from the
-- import. Today that count is zero, verified against the live database before
-- this file was written. The guard matters for later: once seed_grandola has
-- run, or once a reviewer has promoted a real finding, this migration must not
-- be capable of deleting it. Re-running then aborts instead.
do $$
declare
  v_other int;
  v_csv   int;
begin
  select count(*) into v_other from knowledge_nodes
    where verified_by is distinct from 'csv_import';
  select count(*) into v_csv from knowledge_nodes
    where verified_by = 'csv_import';

  if v_other > 0 then
    raise exception
      'refusing to run: % knowledge_nodes row(s) are not from the csv import. '
      'This migration is only safe while the import is the sole content. '
      'Delete the import rows by hand if that is still what you want.', v_other;
  end if;

  raise notice 'removing % csv_import node(s)', v_csv;
end $$;

-- ---------- 1. the nodes ----------
--
-- citations and edges both cascade from knowledge_nodes (0001), and both are
-- empty in any case. Deleted by the import's own marker rather than by a bare
-- `delete from knowledge_nodes` so the statement says what it targets and
-- cannot quietly take anything a later seed has added.
delete from knowledge_nodes where verified_by = 'csv_import';

-- ---------- 2. the municipalities ----------
--
-- All 290 are the flattened import (district = region = 'Portugal'), so this
-- clears the table rather than trying to repair rows. seed_grandola recreates
-- the pilot municipality with its real district and region, and it is
-- re-runnable: it skips a municipality that already exists, which is exactly
-- why the flattened row has to go first or the seed would leave it as it is.
--
-- Safe to delete outright: research_tasks and findings are both empty, and the
-- nodes that referenced these rows went in step 1.
delete from municipalities where district = 'Portugal' and region = 'Portugal';

commit;

-- After this runs:
--   python -m kb.seed_grandola     -- real claims, real sources, real tiers
--   python -m kb.sync_wiki         -- the 108-article corpus (needs 0007 first)
