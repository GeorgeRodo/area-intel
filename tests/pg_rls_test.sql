-- tests/pg_rls_test.sql
-- Exercises the database-enforced review gate, the invite-only posture (0005)
-- and the audited admin maintenance paths (0006). Expected failures are caught
-- and printed as PASS lines; any unexpected behavior raises and aborts.
\set ON_ERROR_STOP on

-- ---- fixtures (as owner: simulates worker/seed, bypasses RLS) ----

-- Since 0005 the signup trigger aborts for an uninvited address, so the invite
-- has to exist before the auth.users row — including here. The invite carries
-- the role, which is why no profile UPDATE follows.
insert into invited_emails (email, role) values
  ('reader@test.pt', 'user'),
  ('paulo@test.pt',  'admin');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'reader@test.pt'),
  ('22222222-2222-2222-2222-222222222222', 'paulo@test.pt');

do $$
declare v_role text;
begin
  select role into v_role from profiles where id = '22222222-2222-2222-2222-222222222222';
  if v_role <> 'admin' then raise exception 'FAIL invite role not applied, got %', v_role; end if;
  raise notice 'PASS invite role carried onto the new profile';

  begin
    insert into auth.users (id, email)
      values ('33333333-3333-3333-3333-333333333333', 'uninvited@test.pt');
    raise exception 'FAIL uninvited signup created an account';
  exception when insufficient_privilege then
    raise notice 'PASS uninvited signup refused';
  end;
end $$;

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

-- =================== USER ===================
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare n int;
begin
  select count(*) into n from knowledge_nodes;
  if n <> 2 then raise exception 'FAIL user sees % nodes, expected 2 (pending hidden)', n; end if;
  raise notice 'PASS user sees only verified nodes (%)', n;

  select count(*) into n from findings;
  if n <> 0 then raise exception 'FAIL user sees findings'; end if;
  raise notice 'PASS findings invisible to user';

  begin
    insert into knowledge_nodes (municipality_id, category, title, body)
      values (1,'market','hack','hack');
    raise exception 'FAIL user inserted a node directly';
  exception when insufficient_privilege then
    raise notice 'PASS direct node insert denied for user';
  end;

  begin
    perform promote_finding(1, 'A');
    raise exception 'FAIL user promoted a finding';
  exception when raise_exception then
    raise notice 'PASS promote_finding refuses non-admin';
  end;

  insert into research_tasks (municipality_id, question) values (1, 'User question about AL licensing?');
  raise notice 'PASS user can ask (task insert)';

  -- 0006: the maintenance RPCs carry the same gate as promotion.
  begin
    perform retier_node(1, 'D', 'downgrading everything for fun');
    raise exception 'FAIL user re-tiered a node';
  exception when raise_exception then
    raise notice 'PASS retier_node refuses non-admin';
  end;

  begin
    perform set_node_status(1, 'rejected', 'burning the knowledge base down');
    raise exception 'FAIL user changed node status';
  exception when raise_exception then
    raise notice 'PASS set_node_status refuses non-admin';
  end;

  begin
    perform invite_user('attacker@test.pt', 'admin');
    raise exception 'FAIL user issued an invite';
  exception when raise_exception then
    raise notice 'PASS invite_user refuses non-admin';
  end;

  select count(*) into n from invited_emails;
  if n <> 0 then raise exception 'FAIL user sees % invites, expected 0', n; end if;
  raise notice 'PASS invite list invisible to user';

  select count(*) into n from audit_log;
  if n <> 0 then raise exception 'FAIL user sees % audit rows, expected 0', n; end if;
  raise notice 'PASS audit log invisible to user';
end $$;

-- =================== ADMIN ===================
set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
declare n int; v_node int; v_fresh bigint;
begin
  select count(*) into n from findings where review_status = 'pending';
  if n <> 1 then raise exception 'FAIL admin queue count %', n; end if;
  raise notice 'PASS admin sees pending queue';

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

-- =================== ADMIN: 0006 maintenance ===================
do $$
declare n int; v_tier text; v_status text; v_before jsonb; v_after jsonb;
begin
  -- re-tier
  perform retier_node(1, 'B', 'DR text re-read: applies from Aug, not in force yet — B until confirmed.');
  select tier into v_tier from knowledge_nodes where id = 1;
  if v_tier <> 'B' then raise exception 'FAIL retier left tier at %', v_tier; end if;
  raise notice 'PASS retier_node changed tier A -> B';

  select before, after into v_before, v_after from audit_log
    where action = 'retier_node' and entity_id = '1';
  if v_before->>'tier' <> 'A' or v_after->>'tier' <> 'B' then
    raise exception 'FAIL audit recorded % -> %', v_before, v_after;
  end if;
  raise notice 'PASS audit row records the before and after tier';

  -- the reason is mandatory: an unexplained re-tier is not reviewable later
  begin
    perform retier_node(2, 'D', '');
    raise exception 'FAIL re-tier accepted with no reason';
  exception when raise_exception then
    raise notice 'PASS retier_node requires a reason';
  end;

  begin
    perform retier_node(1, 'B', 'already this tier');
    raise exception 'FAIL no-op re-tier accepted';
  exception when raise_exception then
    raise notice 'PASS retier_node rejects a no-op';
  end;

  begin
    perform retier_node(1, 'Z', 'not a tier');
    raise exception 'FAIL invalid tier accepted';
  exception when raise_exception then
    raise notice 'PASS retier_node validates the tier';
  end;

  -- retire a claim (the honest alternative to deleting it)
  perform set_node_status(2, 'rejected', 'Superseded by the Q3 asking-price series.');
  select status into v_status from knowledge_nodes where id = 2;
  if v_status <> 'rejected' then raise exception 'FAIL status is %', v_status; end if;
  raise notice 'PASS set_node_status retired a claim';

  select count(*) into n from knowledge_nodes where id = 2;
  if n <> 1 then raise exception 'FAIL retired node disappeared'; end if;
  raise notice 'PASS retired claim is still on the record, not deleted';

  -- pipeline statuses stay out of admin hands
  begin
    perform set_node_status(1, 'pending_review', 'back to the queue');
    raise exception 'FAIL admin pushed a node into pending_review';
  exception when raise_exception then
    raise notice 'PASS set_node_status refuses pipeline statuses';
  end;
end $$;

-- =================== ADMIN: 0006 invitations ===================
do $$
declare n int; v_role text;
begin
  perform invite_user('newbie@test.pt', 'user');
  select role into v_role from invited_emails where email = 'newbie@test.pt';
  if v_role <> 'user' then raise exception 'FAIL invite role %', v_role; end if;
  raise notice 'PASS invite_user issued an invite';

  -- re-inviting an unclaimed address corrects the role
  perform invite_user('NEWBIE@test.pt', 'admin');
  select count(*) into n from invited_emails where email = 'newbie@test.pt';
  if n <> 1 then raise exception 'FAIL re-invite created % rows', n; end if;
  select role into v_role from invited_emails where email = 'newbie@test.pt';
  if v_role <> 'admin' then raise exception 'FAIL re-invite left role %', v_role; end if;
  raise notice 'PASS re-invite updates the role and normalizes the address';

  begin
    perform invite_user('paulo@test.pt', 'user');
    raise exception 'FAIL re-invited an address that already signed up';
  exception when raise_exception then
    raise notice 'PASS invite_user refuses a claimed address';
  end;

  begin
    perform invite_user('not-an-email', 'user');
    raise exception 'FAIL invalid address accepted';
  exception when raise_exception then
    raise notice 'PASS invite_user validates the address';
  end;

  perform revoke_invite('newbie@test.pt');
  select count(*) into n from invited_emails where email = 'newbie@test.pt';
  if n <> 0 then raise exception 'FAIL invite survived revoke'; end if;
  raise notice 'PASS revoke_invite withdrew an unclaimed invite';

  begin
    perform revoke_invite('paulo@test.pt');
    raise exception 'FAIL revoked an invite that was already claimed';
  exception when raise_exception then
    raise notice 'PASS revoke_invite refuses a claimed invite';
  end;

  -- the log is append-only from the client side, even for an admin
  begin
    insert into audit_log (actor_name, action, entity, entity_id)
      values ('paulo', 'forged', 'knowledge_node', '1');
    raise exception 'FAIL admin wrote an audit row directly';
  exception when insufficient_privilege then
    raise notice 'PASS audit log refuses direct writes';
  end;

  begin
    update audit_log set note = 'rewritten' where entity_id = '1';
    raise exception 'FAIL admin edited an audit row';
  exception when insufficient_privilege then
    raise notice 'PASS audit log refuses edits';
  end;

  -- Exactly the five mutations that succeeded: retier, retire, invite,
  -- re-invite, revoke. Every refused attempt raised before reaching the log,
  -- so a failed action leaves no trace claiming it happened.
  select count(*) into n from audit_log;
  if n <> 5 then raise exception 'FAIL audit log has % rows, expected 5', n; end if;
  raise notice 'PASS every successful admin mutation left an audit row, and only those (%)', n;
end $$;

-- =================== ANON ===================
-- 0005 revoked the anon grants outright, so an unauthenticated request is
-- refused at the privilege layer rather than quietly returning an empty set.
reset request.jwt.claim.sub;
set role anon;
do $$
declare n int;
begin
  begin
    select count(*) into n from municipalities;
    raise exception 'FAIL anon read % municipalities', n;
  exception when insufficient_privilege then
    raise notice 'PASS anon cannot read municipalities';
  end;

  begin
    select count(*) into n from knowledge_nodes;
    raise exception 'FAIL anon read % nodes', n;
  exception when insufficient_privilege then
    raise notice 'PASS anon cannot read the knowledge base';
  end;

  begin
    insert into research_tasks (municipality_id, question)
      values (1, 'Anonymous question that would cost money to answer');
    raise exception 'FAIL anon filed a research task';
  exception when insufficient_privilege then
    raise notice 'PASS anon cannot spend agent budget';
  end;
end $$;

reset role;
select 'ALL RLS TESTS PASSED' as result;
