-- 0003_routines.sql
-- Mission Control: routine run history + run-now commands.
-- Worker (table owner) writes runs and consumes commands; clients read runs
-- and, if reviewer, insert commands.

create table routine_runs (
  id integer generated always as identity primary key,
  routine varchar(60) not null,
  status varchar(20) not null default 'ok',
  detail text,
  items_out integer default 0,
  started_at timestamp default now(),
  finished_at timestamp
);
create index idx_runs_routine on routine_runs(routine, started_at desc);

create table routine_commands (
  id integer generated always as identity primary key,
  routine varchar(60) not null,
  requested_by varchar(120) default 'dashboard',
  status varchar(20) default 'pending',
  created_at timestamp default now(),
  executed_at timestamp
);

alter table routine_runs enable row level security;
alter table routine_commands enable row level security;

create policy runs_read on routine_runs for select using (true);
create policy cmd_read on routine_commands for select using (is_reviewer());
create policy cmd_insert on routine_commands for insert
  with check (is_reviewer());

grant select on routine_runs, routine_commands to anon, authenticated;
grant insert on routine_commands to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
