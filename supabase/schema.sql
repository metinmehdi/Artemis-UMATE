-- UMATE cloud database (Supabase). Run once per project; safe to run again.
-- Row level security is on and there are no policies: browsers cannot read or write these tables.
-- Only the Vercel functions (service key) can. Phone <-> panel live traffic uses Realtime broadcast,
-- which does not touch the tables.

-- Session log: one row per app event or buddy transcript line (same content as the laptop's JSONL).
create table if not exists public.events (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  t bigint not null,                -- client time, ms since 1970
  room text,                        -- panel room code that paired phone and panel
  session_id text not null,
  learner_id text,
  learner_nickname text,
  type text not null,               -- 'event' or 'transcript'
  name text,                        -- event name (step_enter, wallet, error, hint_shown, ...)
  step int,
  node text,
  data jsonb not null default '{}'::jsonb
);
create index if not exists events_session_idx on public.events (session_id);
create index if not exists events_learner_idx on public.events (learner_id);

-- Learner profiles (nicknames only; no accounts).
create table if not exists public.learners (
  id text primary key,
  nickname text not null,
  created_at timestamptz not null default now()
);

alter table public.events enable row level security;
alter table public.learners enable row level security;

insert into public.learners (id, nickname) values ('demo', 'Demo (judge)') on conflict do nothing;
