-- tests/pg_rls_test.sql
-- Exercises the database-enforced review gate. Expected failures are caught
-- and printed as PASS lines; any unexpected behavior raises and aborts.
\set ON_ERROR_STOP on

-- ---- fixtures (as owner: simulates worker/seed, bypasses RLS) ----
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reader@test.pt'),
  ('22222222-2222-2222-2222-222222222222', 'paulo@test.pt');
update profiles set role = 'reviewer', display_name = 'paulo'
  where id = '22222222-2222-2222-2222-222222222222';

insert into municipalities (name, district, region) values ('Grandola','Setubal','Alentejo Litoral');

insert into knowledge_nodes (municipality_id, category, title, body, tier, status, as_of, verified_by)
values
 (1,'regulatory','DL 108/2026 in force 3 Aug 2026','body',       'A','verified', current_date, 'team-seed'),
 (1,'market',    'Melides median ~7240/m2',        'body',       'B','verified', current_date, 'team-seed'),
 (1,'market',    'SECRET draft node',              'not public', 'D','pending_review', current_date, null);

insert into research_tasks (municipality_id, question, requested_by)
values (1, 'What special assessments are pending in Troia condominiums?', 'worker-test');

insert into findings (task_id, category, title, body, proposed_tier, source_name, source_url)
values (1, 'condo', 'Pending EUR 60K road assessment', 'Administrator confirmed...', 'C',
        'Condo administrator call', 'tel:verified');

-- =================== READER ===================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  select count(*) into n from knowledge_nodes;
  if n <> 2 then raise exception 'FAIL reader sees % nodes, expected 2 (pending hidden)', n; end if;
  raise notice 'PASS reader sees only verified nodes (%)', n;

  select count(*) into n from findings;
  if n <> 0 then raise exception 'FAIL reader sees findings'; end if;
  raise notice 'PASS findings invisible to reader';

  begin
    insert into knowledge_nodes (municipality_id, category, title, body)
      values (1,'market','hack','hack');
    raise exception 'FAIL reader inserted a node directly';
  exception when insufficient_privilege then
    raise notice 'PASS direct node insert denied for reader';
  end;

  begin
    perform promote_finding(1, 'A');
    raise exception 'FAIL reader promoted a finding';
  exception when raise_exception then
    raise notice 'PASS promote_finding refuses non-reviewer';
  end;

  insert into research_tasks (municipality_id, question) values (1, 'Reader question about AL licensing?');
  raise notice 'PASS reader can ask (task insert)';
end $$;

-- =================== REVIEWER ===================
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare n int; v_node int; v_fresh bigint;
begin
  select count(*) into n from findings where review_status = 'pending';
  if n <> 1 then raise exception 'FAIL reviewer queue count %', n; end if;
  raise notice 'PASS reviewer sees pending queue';

  select promote_finding(1, 'C', null, 'Edited body: EUR 60K confirmed, verify minutes for tier B.', 'condo')
    into v_node;
  raise notice 'PASS promote_finding -> node %', v_node;

  select verified_fresh into v_fresh from coverage(1) where category = 'condo';
  if v_fresh <> 1 then raise exception 'FAIL condo coverage % after promote', v_fresh; end if;
  raise notice 'PASS coverage reflects promotion';

  select count(*) into n from nodes_view where fresh and status = 'verified';
  if n <> 3 then raise exception 'FAIL nodes_view fresh count %', n; end if;
  raise notice 'PASS nodes_view computes freshness + sources';

  begin
    perform promote_finding(1, 'A');
    raise exception 'FAIL double promotion allowed';
  exception when raise_exception then
    raise notice 'PASS double promotion blocked';
  end;
end $$;

-- =================== ANON ===================
reset request.jwt.claim.sub;
set role anon;
do $$
declare n int;
begin
  select count(*) into n from municipalities;
  if n <> 1 then raise exception 'FAIL anon municipalities'; end if;
  select count(*) into n from knowledge_nodes where status = 'verified';
  if n <> 3 then raise exception 'FAIL anon verified nodes %', n; end if;
  raise notice 'PASS anon reads public brief';
end $$;

reset role;
select 'ALL RLS TESTS PASSED' as result;
