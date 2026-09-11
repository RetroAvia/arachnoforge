-- =====================================================================
-- ArachnoForge — Biometric Suit HUD & K.A.R.E.N. AI Engine (Fase 1)
-- Schema per: suit_biometrics, cadet_subjective_logs, karen_briefings
-- =====================================================================
-- Da eseguire nel SQL Editor di Supabase (Project -> SQL Editor -> New
-- query), una sola volta. Come per supabase/rls_user_data.sql, lo script
-- è idempotente: puoi rieseguirlo in sicurezza senza errori
-- "already exists".
--
-- COMPARTIMENTI STAGNI: queste 3 tabelle sono completamente isolate dal
-- JSONB "Cloud State" (public.user_data, Pillar 3) usato dal resto
-- dell'app — nessuna colonna condivisa, nessuna FK verso user_data.
-- Il Suit Telemetry HUD (Fase 2) le leggerà come fonte a parte.
--
-- MODELLO DI SICUREZZA (asimmetrico e deliberato):
--   - suit_biometrics        -> l'utente può SELECT/INSERT/UPDATE solo le
--                               proprie righe (ingestione diretta da
--                               Apple Shortcuts via REST, vedi guida
--                               pipeline).
--   - cadet_subjective_logs  -> l'utente può SELECT/INSERT/UPDATE solo le
--                               proprie righe (form "Suit Telemetry" in
--                               app, Fase 2).
--   - karen_briefings        -> l'utente può SOLO leggere (SELECT) i
--                               propri briefing. INSERT/UPDATE NON sono
--                               concessi al ruolo "authenticated": solo
--                               l'Edge Function karen-oracle, che opera
--                               con la Service Role Key (bypassa la RLS
--                               per definizione), può scrivere un
--                               briefing. Questo impedisce a un client
--                               malevolo di iniettare un "briefing"
--                               falso o un readiness_score arbitrario
--                               nella cronologia dell'utente.
-- =====================================================================

create extension if not exists pgcrypto;


-- ---------------------------------------------------------------------
-- TABELLA 1 — suit_biometrics (dati oggettivi da Apple Health / Xiaomi Band)
-- ---------------------------------------------------------------------
create table if not exists public.suit_biometrics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  date              date not null,
  sleep_total_min   integer check (sleep_total_min is null or sleep_total_min >= 0),
  sleep_deep_min    integer check (sleep_deep_min is null or sleep_deep_min >= 0),
  sleep_rem_min     integer check (sleep_rem_min is null or sleep_rem_min >= 0),
  resting_hr        integer check (resting_hr is null or resting_hr between 20 and 220),
  steps             integer check (steps is null or steps >= 0),
  active_calories   integer check (active_calories is null or active_calories >= 0),
  -- Payload grezzo cosi' come arrivato dal Comando Rapido iOS — mai
  -- perso anche se in futuro cambia la formula del Readiness Score o si
  -- vogliono recuperare campi non ancora mappati in colonne dedicate.
  raw_data          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- Una sola riga per utente per giorno — required per l'upsert
-- (onConflict: 'user_id,date') sia dal Comando Rapido sia da un futuro
-- re-invio dello stesso giorno (es. sync serale che corregge il mattino).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'suit_biometrics_user_date_key'
      and conrelid = 'public.suit_biometrics'::regclass
  ) then
    alter table public.suit_biometrics
      add constraint suit_biometrics_user_date_key unique (user_id, date);
  end if;
end $$;

create index if not exists idx_suit_biometrics_user_date
  on public.suit_biometrics (user_id, date desc);


-- ---------------------------------------------------------------------
-- TABELLA 2 — cadet_subjective_logs (metriche soggettive loggate a mano)
-- ---------------------------------------------------------------------
create table if not exists public.cadet_subjective_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  date          date not null,
  focus_level   smallint check (focus_level is null or focus_level between 1 and 10),
  mood          smallint check (mood is null or mood between 1 and 10),
  caffeine_mg   integer check (caffeine_mg is null or caffeine_mg >= 0),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'cadet_subjective_logs_user_date_key'
      and conrelid = 'public.cadet_subjective_logs'::regclass
  ) then
    alter table public.cadet_subjective_logs
      add constraint cadet_subjective_logs_user_date_key unique (user_id, date);
  end if;
end $$;

create index if not exists idx_cadet_subjective_logs_user_date
  on public.cadet_subjective_logs (user_id, date desc);


-- ---------------------------------------------------------------------
-- TABELLA 3 — karen_briefings (output generato server-side da karen-oracle)
-- ---------------------------------------------------------------------
create table if not exists public.karen_briefings (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  date              date not null,
  readiness_score   smallint not null check (readiness_score between 0 and 100),
  briefing_text     text not null,
  tactical_advice   text not null,
  -- Traccia quali componenti dati erano disponibili quel giorno (utile
  -- in Fase 2 per mostrare badge "dati parziali" nell'HUD invece di far
  -- credere che lo score sia sempre calcolato sul set completo).
  score_breakdown   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'karen_briefings_user_date_key'
      and conrelid = 'public.karen_briefings'::regclass
  ) then
    alter table public.karen_briefings
      add constraint karen_briefings_user_date_key unique (user_id, date);
  end if;
end $$;

create index if not exists idx_karen_briefings_user_date
  on public.karen_briefings (user_id, date desc);


-- ---------------------------------------------------------------------
-- RLS — attivazione + FORCE su tutte e 3 le tabelle
-- ---------------------------------------------------------------------
alter table public.suit_biometrics        enable row level security;
alter table public.suit_biometrics        force row level security;
alter table public.cadet_subjective_logs  enable row level security;
alter table public.cadet_subjective_logs  force row level security;
alter table public.karen_briefings        enable row level security;
alter table public.karen_briefings        force row level security;


-- ---------------------------------------------------------------------
-- GRANT di tabella (Postgres li valuta PRIMA delle policy RLS)
-- ---------------------------------------------------------------------
revoke all on public.suit_biometrics       from anon;
revoke all on public.cadet_subjective_logs from anon;
revoke all on public.karen_briefings       from anon;

grant select, insert, update on public.suit_biometrics       to authenticated;
grant select, insert, update on public.cadet_subjective_logs to authenticated;
-- karen_briefings: SOLO SELECT per "authenticated" — vedi nota sicurezza
-- in testa al file. Scrittura riservata alla Service Role (Edge Function).
grant select on public.karen_briefings to authenticated;


-- ---------------------------------------------------------------------
-- POLICY — suit_biometrics
-- ---------------------------------------------------------------------
drop policy if exists "suit_biometrics_select_own" on public.suit_biometrics;
create policy "suit_biometrics_select_own"
  on public.suit_biometrics for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "suit_biometrics_insert_own" on public.suit_biometrics;
create policy "suit_biometrics_insert_own"
  on public.suit_biometrics for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "suit_biometrics_update_own" on public.suit_biometrics;
create policy "suit_biometrics_update_own"
  on public.suit_biometrics for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- POLICY — cadet_subjective_logs
-- ---------------------------------------------------------------------
drop policy if exists "cadet_subjective_logs_select_own" on public.cadet_subjective_logs;
create policy "cadet_subjective_logs_select_own"
  on public.cadet_subjective_logs for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "cadet_subjective_logs_insert_own" on public.cadet_subjective_logs;
create policy "cadet_subjective_logs_insert_own"
  on public.cadet_subjective_logs for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "cadet_subjective_logs_update_own" on public.cadet_subjective_logs;
create policy "cadet_subjective_logs_update_own"
  on public.cadet_subjective_logs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);


-- ---------------------------------------------------------------------
-- POLICY — karen_briefings (SELECT-only per "authenticated")
-- ---------------------------------------------------------------------
drop policy if exists "karen_briefings_select_own" on public.karen_briefings;
create policy "karen_briefings_select_own"
  on public.karen_briefings for select
  to authenticated
  using (auth.uid() = user_id);

-- Nessuna policy INSERT/UPDATE/DELETE per "authenticated": con RLS attiva
-- e nessuna policy per quei comandi, sono respinti di default. La Service
-- Role Key usata da karen-oracle bypassa comunque la RLS per progetto
-- (comportamento nativo di Supabase per quel ruolo), quindi non serve
-- (né si deve) creare una policy dedicata al service_role.


-- ---------------------------------------------------------------------
-- Trigger updated_at (facoltativo ma coerente con le colonne sopra)
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_suit_biometrics_updated_at on public.suit_biometrics;
create trigger trg_suit_biometrics_updated_at
  before update on public.suit_biometrics
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cadet_subjective_logs_updated_at on public.cadet_subjective_logs;
create trigger trg_cadet_subjective_logs_updated_at
  before update on public.cadet_subjective_logs
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- Verifica finale (facoltativo — decommenta ed esegui a parte)
-- ---------------------------------------------------------------------
-- select relname, relrowsecurity, relforcerowsecurity
--   from pg_class
--   where relname in ('suit_biometrics', 'cadet_subjective_logs', 'karen_briefings');
--
-- select tablename, policyname, cmd, roles
--   from pg_policies
--   where tablename in ('suit_biometrics', 'cadet_subjective_logs', 'karen_briefings');
