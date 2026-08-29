create extension if not exists pgcrypto;

create table if not exists public.rooms (
  code text primary key,
  status text not null default 'lobby' check (status in ('lobby', 'playing', 'round_end')),
  current_word text,
  drawer_player_id uuid,
  round_number int not null default 0,
  round_ends_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  name text not null,
  score int not null default 0,
  session_key text,
  last_seen_at timestamptz,
  disconnected_at timestamptz,
  joined_at timestamptz not null default now()
);

alter table public.players add column if not exists session_key text;
alter table public.players add column if not exists last_seen_at timestamptz;
alter table public.players add column if not exists disconnected_at timestamptz;

create table if not exists public.guesses (
  id bigint generated always as identity primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  text text not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.room_settings (
  room_code text primary key references public.rooms(code) on delete cascade,
  round_seconds int not null default 90 check (round_seconds between 15 and 300),
  round_limit int not null default 5 check (round_limit between 1 and 20),
  language text not null default 'en',
  word_pack text not null default 'easy',
  max_players int not null default 10 check (max_players between 2 and 10),
  scoring_mode text not null default 'speed' check (scoring_mode in ('speed', 'flat', 'off')),
  custom_words text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_summaries (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  round_number int not null,
  word text not null,
  drawer_player_id uuid references public.players(id) on delete set null,
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  ended_reason text not null default 'guessed' check (ended_reason in ('guessed', 'timer', 'restart', 'drawer_left', 'manual')),
  drawing_events jsonb not null default '[]'::jsonb,
  drawing_image text,
  results jsonb not null default '[]'::jsonb,
  standings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (room_code, round_number)
);

create table if not exists public.final_results (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  completed_at timestamptz not null default now(),
  winner_player_id uuid references public.players(id) on delete set null,
  rounds_played int not null default 0,
  standings jsonb not null default '[]'::jsonb,
  top_drawings jsonb not null default '[]'::jsonb,
  share_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.spectators (
  id uuid primary key default gen_random_uuid(),
  room_code text not null references public.rooms(code) on delete cascade,
  name text not null,
  session_key text,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists players_room_code_idx on public.players(room_code);
create unique index if not exists players_room_session_key_idx on public.players(room_code, session_key);
create index if not exists guesses_room_code_created_at_idx on public.guesses(room_code, created_at desc);
create index if not exists round_summaries_room_round_idx on public.round_summaries(room_code, round_number desc);
create index if not exists final_results_room_completed_idx on public.final_results(room_code, completed_at desc);
create index if not exists spectators_room_code_idx on public.spectators(room_code);
create unique index if not exists spectators_room_session_key_idx on public.spectators(room_code, session_key);

-- Demo-only policy model: this hackathon MVP trusts room participants and keeps
-- setup fast. Do not use these broad anon policies unchanged for production.
alter table public.rooms replica identity full;
alter table public.players replica identity full;
alter table public.guesses replica identity full;
alter table public.room_settings replica identity full;
alter table public.round_summaries replica identity full;
alter table public.final_results replica identity full;
alter table public.spectators replica identity full;

alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.guesses enable row level security;
alter table public.room_settings enable row level security;
alter table public.round_summaries enable row level security;
alter table public.final_results enable row level security;
alter table public.spectators enable row level security;

drop policy if exists "demo read rooms" on public.rooms;
drop policy if exists "demo insert rooms" on public.rooms;
drop policy if exists "demo update rooms" on public.rooms;
drop policy if exists "demo delete rooms" on public.rooms;
drop policy if exists "demo read players" on public.players;
drop policy if exists "demo insert players" on public.players;
drop policy if exists "demo update players" on public.players;
drop policy if exists "demo delete players" on public.players;
drop policy if exists "demo read guesses" on public.guesses;
drop policy if exists "demo insert guesses" on public.guesses;
drop policy if exists "demo update guesses" on public.guesses;
drop policy if exists "demo delete guesses" on public.guesses;
drop policy if exists "demo read room settings" on public.room_settings;
drop policy if exists "demo insert room settings" on public.room_settings;
drop policy if exists "demo update room settings" on public.room_settings;
drop policy if exists "demo delete room settings" on public.room_settings;
drop policy if exists "demo read round summaries" on public.round_summaries;
drop policy if exists "demo insert round summaries" on public.round_summaries;
drop policy if exists "demo update round summaries" on public.round_summaries;
drop policy if exists "demo delete round summaries" on public.round_summaries;
drop policy if exists "demo read final results" on public.final_results;
drop policy if exists "demo insert final results" on public.final_results;
drop policy if exists "demo update final results" on public.final_results;
drop policy if exists "demo delete final results" on public.final_results;
drop policy if exists "demo read spectators" on public.spectators;
drop policy if exists "demo insert spectators" on public.spectators;
drop policy if exists "demo update spectators" on public.spectators;
drop policy if exists "demo delete spectators" on public.spectators;

create policy "demo read rooms" on public.rooms for select using (true);
create policy "demo insert rooms" on public.rooms for insert with check (true);
create policy "demo update rooms" on public.rooms for update using (true) with check (true);
create policy "demo delete rooms" on public.rooms for delete using (true);

create policy "demo read players" on public.players for select using (true);
create policy "demo insert players" on public.players for insert with check (true);
create policy "demo update players" on public.players for update using (true) with check (true);
create policy "demo delete players" on public.players for delete using (true);

create policy "demo read guesses" on public.guesses for select using (true);
create policy "demo insert guesses" on public.guesses for insert with check (true);
create policy "demo update guesses" on public.guesses for update using (true) with check (true);
create policy "demo delete guesses" on public.guesses for delete using (true);

create policy "demo read room settings" on public.room_settings for select using (true);
create policy "demo insert room settings" on public.room_settings for insert with check (true);
create policy "demo update room settings" on public.room_settings for update using (true) with check (true);
create policy "demo delete room settings" on public.room_settings for delete using (true);

create policy "demo read round summaries" on public.round_summaries for select using (true);
create policy "demo insert round summaries" on public.round_summaries for insert with check (true);
create policy "demo update round summaries" on public.round_summaries for update using (true) with check (true);
create policy "demo delete round summaries" on public.round_summaries for delete using (true);

create policy "demo read final results" on public.final_results for select using (true);
create policy "demo insert final results" on public.final_results for insert with check (true);
create policy "demo update final results" on public.final_results for update using (true) with check (true);
create policy "demo delete final results" on public.final_results for delete using (true);

create policy "demo read spectators" on public.spectators for select using (true);
create policy "demo insert spectators" on public.spectators for insert with check (true);
create policy "demo update spectators" on public.spectators for update using (true) with check (true);
create policy "demo delete spectators" on public.spectators for delete using (true);

do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.players;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.guesses;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.room_settings;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.round_summaries;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.final_results;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.spectators;
exception
  when duplicate_object then null;
end $$;
