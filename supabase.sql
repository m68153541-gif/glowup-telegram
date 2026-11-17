-- GlowUp: общая база для админ-действий и прогресса игроков.
-- Выполнить в Supabase → SQL Editor после создания проекта.

create table if not exists glowup_control (
  id integer primary key default 1,
  reset_epoch integer not null default 0,
  grant_epoch integer not null default 0,
  grant_amount integer not null default 0,
  updated_at timestamptz not null default now()
);

insert into glowup_control (id, reset_epoch, grant_epoch, grant_amount)
values (1, 0, 0, 0)
on conflict (id) do nothing;

create table if not exists glowup_players (
  user_id bigint primary key,
  stars integer not null default 0,
  level integer not null default 1,
  xp integer not null default 0,
  owned jsonb not null default '[]'::jsonb,
  user_nft text,
  loc integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table glowup_control enable row level security;
alter table glowup_players enable row level security;

drop policy if exists glowup_control_read on glowup_control;
create policy glowup_control_read on glowup_control
  for select using (true);

drop policy if exists glowup_control_write on glowup_control;
create policy glowup_control_write on glowup_control
  for update using (true) with check (true);

drop policy if exists glowup_players_read on glowup_players;
create policy glowup_players_read on glowup_players
  for select using (true);

drop policy if exists glowup_players_write on glowup_players;
create policy glowup_players_write on glowup_players
  for insert with check (true);

drop policy if exists glowup_players_update on glowup_players;
create policy glowup_players_update on glowup_players
  for update using (true) with check (true);
