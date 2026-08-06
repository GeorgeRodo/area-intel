-- 0001_schema.sql
-- Mirrors db/models.py exactly (table + column names) so the Python worker's
-- SQLAlchemy layer runs unchanged against Supabase Postgres.
-- Supabase-specific additions: profiles (role source of truth for RLS),
-- research_tasks.requester (auth.uid of the asker).

create table municipalities (
  id integer generated always as identity primary key,
  name varchar(120) unique not null,
  district varchar(120),
  region varchar(120),
  notes text
);

create table sources (
  id integer generated always as identity primary key,
  name varchar(255) not null,
  url text,
  kind varchar(50),
  accessed_at timestamp default now()
);

create table knowledge_nodes (
  id integer generated always as identity primary key,
  municipality_id integer not null references municipalities(id),
  category varchar(40) not null,
  title varchar(255) not null,
  body text not null,
  tier varchar(1) not null default 'D' check (tier in ('A','B','C','D')),
  status varchar(20) not null default 'draft'
    check (status in ('draft','pending_review','verified','stale','rejected')),
  as_of date not null default current_date,
  verified_by varchar(120),
  verified_at timestamp,
  created_by varchar(120) default 'agent',
  created_at timestamp default now(),
  updated_at timestamp default now()
);
create index idx_nodes_muni_cat on knowledge_nodes(municipality_id, category);
create index idx_nodes_status on knowledge_nodes(status);

create table citations (
  id integer generated always as identity primary key,
  node_id integer not null references knowledge_nodes(id) on delete cascade,
  source_id integer not null references sources(id),
  quote_or_ref text
);

create table edges (
  id integer generated always as identity primary key,
  src_node_id integer not null references knowledge_nodes(id) on delete cascade,
  dst_node_id integer not null references knowledge_nodes(id) on delete cascade,
  relation varchar(40) not null,
  note text
);

create table research_tasks (
  id integer generated always as identity primary key,
  municipality_id integer references municipalities(id),
  question text not null,
  requested_by varchar(120) default 'user',
  status varchar(20) default 'open',
  created_at timestamp default now(),
  answered_at timestamp,
  -- Supabase-only column (nullable; SQLAlchemy ignores it):
  requester uuid default auth.uid()
);

create table findings (
  id integer generated always as identity primary key,
  task_id integer not null references research_tasks(id) on delete cascade,
  category varchar(40) not null,
  title varchar(255) not null,
  body text not null,
  proposed_tier varchar(1) default 'D',
  source_name varchar(255),
  source_url text,
  review_status varchar(20) default 'pending',
  review_note text,
  reviewed_by varchar(120),
  created_at timestamp default now(),
  promoted_node_id integer references knowledge_nodes(id)
);
create index idx_findings_pending on findings(review_status) where review_status = 'pending';

-- Role source of truth. Row created on signup via trigger; role changed by
-- service role only (RLS below).
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'reader' check (role in ('reader','reviewer')),
  display_name text not null default 'user',
  created_at timestamp default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)));
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep updated_at honest
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_nodes_touch before update on knowledge_nodes
  for each row execute function public.touch_updated_at();
